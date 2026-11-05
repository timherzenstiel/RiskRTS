// Entry point: `npm start -w @riskrts/server`. PORT (default 8787) and DATA (default ./data) from the environment.
import { GameServer } from './server';

const port = Number(process.env.PORT ?? 8787), dataDir = process.env.DATA ?? './data';
const server = new GameServer({ port, dataDir, spectatorDelay: Number(process.env.SPECTATOR_DELAY ?? 20) });
console.log(`Fronts of 1914 server on ws://localhost:${server.port} · ${server.worlds.size} saved war(s) in ${dataDir}`);
const stop = async () => { console.log('Saving and shutting down…'); await server.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
