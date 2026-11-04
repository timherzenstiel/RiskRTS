// Post-processing chain: MSAA half-float target -> bloom -> tilt-shift + grade -> tone map / sRGB output.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { lerp, smooth } from './util';

const GRADE = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uAmt: { value: 1.5 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmt; uniform vec2 uRes; varying vec2 vUv;
  void main(){
    // tilt-shift: blur grows toward the top and bottom edges, giving the table-top miniature look
    vec2 px=1./uRes; float e=abs(vUv.y-.5)*2.; float r=pow(e,2.2)*uAmt*3.2;
    vec4 c=texture2D(tDiffuse,vUv)*.24;
    for(int i=0;i<8;i++){ float a=float(i)*.7853982; c+=texture2D(tDiffuse,vUv+vec2(cos(a),sin(a))*px*r)*.095; }
    vec3 col=c.rgb; float l=dot(col,vec3(.299,.587,.114));
    col=mix(vec3(l),col,1.14);
    col*=mix(vec3(.95,.985,1.05),vec3(1.05,1.,.93),smoothstep(.05,.6,l));
    float v=smoothstep(1.2,.3,length((vUv-.5)*vec2(1.15,1.)));
    col*=mix(.7,1.,v);
    gl_FragColor=vec4(col,1.);
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .5, .55, .8);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number) { this.composer.setSize(w, h); this.bloom.resolution.set(w / 2, h / 2); this.grade.uniforms.uRes.value.set(w, h); }

  /** Per-frame tuning based on camera distance. */
  tune(dist: number) {
    this.grade.uniforms.uAmt.value = lerp(2.2, 1.0, smooth(8, 90, dist));
    this.bloom.strength = lerp(.55, .3, smooth(10, 60, dist));
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
