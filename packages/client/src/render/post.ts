// Post-processing chain: MSAA half-float target -> bloom -> C&C grade (dither, grain) -> sRGB output.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { lerp, smooth } from './util';

/** 0 = Tiberian (muddy brown/grey), 1 = Red Alert (industrial chrome). */
export type Look = 0 | 1;

/**
 * Command & Conquer grade, applied in display (gamma) space:
 *  - Tiberian (look 0): muddy, desaturated olive-brown; warm dusty highlights, brown shadows.
 *  - Red Alert (look 1): industrial steel; cooler shadows, punchier contrast, a little more colour.
 * Then a 4x4 ordered dither onto a reduced palette (VGA-era banding) and fine film grain.
 */
const GRADE = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uLook: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uLevels: { value: 30 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uLook, uTime, uLevels; uniform vec2 uRes; varying vec2 vUv;
  float bayer(vec2 p){ vec2 q=mod(floor(p),4.); float x=q.x, y=q.y;
    float a=mod(x,2.), b=mod(y,2.), c=floor(x/2.), d=floor(y/2.);
    float m2=2.*a+3.*b-4.*a*b; float m2b=2.*c+3.*d-4.*c*d; return (4.*m2+m2b+.5)/16.; }
  float h21(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
  void main(){
    vec3 lin=max(texture2D(tDiffuse,vUv).rgb,0.);
    vec3 c=pow(lin,vec3(1./2.2));
    float l=dot(c,vec3(.299,.587,.114));
    // saturation and split-toning
    c=mix(vec3(l),c,mix(.86,.98,uLook));
    vec3 sh=mix(vec3(1.05,.97,.84),vec3(.9,.97,1.08),uLook), hi=mix(vec3(1.05,1.,.86),vec3(1.05,1.02,.96),uLook);
    c*=mix(sh,hi,smoothstep(.1,.75,l));
    // gritty contrast: crushed blacks, rolled-off highlights
    float k=mix(1.1,1.18,uLook); c=(c-.4)*k+.4+.035; c=max(c-.01,0.);
    c=c/(1.+max(c-.85,0.)*1.4);
    // grain, stronger in the shadows
    c+=(h21(gl_FragCoord.xy+fract(uTime*7.1)*97.)-.5)*.045*(1.-l*.6);
    // vignette
    float v=smoothstep(1.25,.35,length((vUv-.5)*vec2(1.1,1.)));
    c*=mix(.86,1.,v);
    // ordered dither onto a reduced palette
    c=floor(clamp(c,0.,1.)*uLevels+bayer(gl_FragCoord.xy))/uLevels;
    gl_FragColor=vec4(pow(c,vec3(2.2)),1.);
  }`,
};

export class Post {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private failed = false;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene, private readonly camera: THREE.Camera) {
    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .3, .4, .88);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number) { this.composer.setSize(w, h); this.bloom.resolution.set(w / 2, h / 2); this.grade.uniforms.uRes.value.set(w, h); }

  /** Per-frame tuning based on camera distance. */
  tune(dist: number, look: Look, time: number) {
    const u = this.grade.uniforms; u.uLook.value = look; u.uTime.value = time;
    this.bloom.strength = lerp(.32, .14, smooth(10, 60, dist));
  }

  render() {
    if (!this.failed) {
      try { this.composer.render(); return; }
      catch (e) { this.failed = true; console.warn('post-processing disabled, falling back to plain rendering', e); }
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.composer.passes.forEach((p) => p.dispose());
    this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose();
  }
}
