// Independent Node.js reference for local verification.
const text=require('node:fs').readFileSync(0,'utf8');
const p=text.trim().split(/\s+/).slice(1).map(Number);let low=Infinity,best=0;
for(const x of p){if(x-low>best)best=x-low;if(x<low)low=x;}
console.log(best);
