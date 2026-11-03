// Independent Node.js reference for local verification.
const text=require('node:fs').readFileSync(0,'utf8');
const t=text.trim().split(/\s+/).map(Number),n=t[0],target=t[1],a=t.slice(2).sort((x,y)=>x-y);
// Two pointers over the sorted values, counting equal blocks together.
let i=0,j=n-1,pairs=0;
while(i<j){const s=a[i]+a[j];
  if(s<target)i++;else if(s>target)j--;
  else if(a[i]===a[j]){const k=j-i+1;pairs+=k*(k-1)/2;break;}
  else{let ci=1,cj=1;while(i+ci<j&&a[i+ci]===a[i])ci++;while(j-cj>i&&a[j-cj]===a[j])cj++;pairs+=ci*cj;i+=ci;j-=cj;}}
console.log(pairs);
