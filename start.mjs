import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server=fileURLToPath(new URL('./server.mjs',import.meta.url));
const children=new Set();
let stopping=false,exitCode=0,timer;
function stop(code=0,signal='SIGTERM') {
  if (stopping) return;
  stopping=true;exitCode=code;
  for (const child of children) child.kill(signal);
  timer=setTimeout(()=>{for (const child of children) child.kill('SIGKILL');},8000);
  timer.unref();
  if (!children.size) process.exit(exitCode);
}
function launch(args,label) {
  const child=spawn(process.execPath,[server,...args],{stdio:'inherit',env:process.env});
  children.add(child);
  child.on('error',()=>{console.error('Unable to start Ringonyx '+label+'.');stop(1);});
  child.on('close',code=>{
    children.delete(child);
    if (!stopping) {
      console.error('Ringonyx '+label+' stopped unexpectedly.');
      stop(code || 1);
    }
    if (stopping && !children.size) {clearTimeout(timer);process.exit(exitCode);}
  });
}
process.on('SIGTERM',()=>stop());
process.on('SIGINT',()=>stop(0,'SIGINT'));
launch([],'web server');
if (process.env.RINGONYX_DELIVERY_WORKER_ENABLED==='true') launch(['--delivery-worker'],'delivery worker');
