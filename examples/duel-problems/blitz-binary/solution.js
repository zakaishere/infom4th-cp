// Independent Node.js reference for local verification.
const text=require('node:fs').readFileSync(0,'utf8');
let n=BigInt(text.trim());const bits=[];
do{bits.push(String(n%2n));n/=2n;}while(n>0n);
console.log(bits.reverse().join(''));
