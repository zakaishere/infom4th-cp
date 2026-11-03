// Independent Node.js reference for local verification.
const text=require('node:fs').readFileSync(0,'utf8');
const a=text.trim().split(/\s+/).slice(1).map(Number);
const max=a.reduce((m,x)=>x>m?x:m,-Infinity);let best=null;
for(const x of a)if(x<max&&(best===null||x>best))best=x;
console.log(best===null?'NONE':String(best));
