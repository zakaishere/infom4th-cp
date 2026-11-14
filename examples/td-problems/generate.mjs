// Academic bank: the exercises of the C programming TDs (Td1-Td6, "Correction des TD"),
// rewritten as judged problems. Prompts ("Entrez ...") are gone: programs read stdin and print
// only the answer. Every expected output comes from an oracle in this file, written apart from the
// C reference (solution.c, adapted from the TD correction and uploaded to the platform).
// Run from the repository root:  node examples/td-problems/generate.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
let seed=20261110;
const random=(lo,hi)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return lo+seed%(hi-lo+1);};
const pick=a=>a[random(0,a.length-1)];
const array=(n,lo,hi)=>Array.from({length:n},()=>random(lo,hi));
const LOWER='abcdefghijklmnopqrstuvwxyz';
const word=(lo,hi,letters=LOWER)=>Array.from({length:random(lo,hi)},()=>pick(letters)).join('');
const sentence=(words,lo=1,hi=8,gap=()=>' ')=>Array.from({length:words},()=>word(lo,hi)).join(gap());
const TESTS=12;
const C=body=>body.trim()+'\n';
// Reads one line without its end of line (fgets keeps '\n'; Windows files may add '\r').
const READ_LINE=`static void lireLigne(char *s, int taille) {
    if (fgets(s, taille, stdin) == NULL) s[0] = '\\0';
    s[strcspn(s, "\\r\\n")] = '\\0';
}`;
const lines=input=>input.replace(/\r/g,'').split('\n');

const problems=[];
function add(td,p,cases,oracle) {
  assert.equal(cases.length,TESTS,p.slug);
  for(const c of cases)assert.ok(c.endsWith('\n'),p.slug+': input must end with a newline');
  problems.push({...p,td,difficulty:p.difficulty??'EASY',timeLimitMs:1000,memoryLimitMb:256,checker:p.checker??'TOKENS',
    languages:['C','CPP','JAVA','PYTHON'],
    tests:cases.map(input=>{const out=String(oracle(input)).replace(/[ \t]+$/gm,'').trimEnd();return {input,expected:out+'\n'};})});
}

// ================= TD1: types, opérateurs, conditions, entrées/sorties =================
{
  const cases=['5 13\n','0 0\n',...Array.from({length:4},()=>`${random(0,20)} ${random(0,100)}\n`),'1000000 1000000000\n','0 1000000000\n','999999 7\n',
    ...Array.from({length:3},()=>`${random(0,1000000)} ${random(0,1000000000)}\n`)];
  add(1,{slug:'td1-incrementations',title:'Pré et post-incrémentation',tags:['operateurs'],
    statement:'On lit deux entiers **A** et **B**, puis on exécute exactement les instructions suivantes :\n\n```c\nC = ++A;\nD = B--;\nE = D / C;\nD++;\nF = D % A;\n```\n\nAffichez les valeurs finales des six variables. Attention à la différence entre `++A` (pré-incrémentation) et `B--` (post-décrémentation), et à la division entière.',
    inputFormat:'Une ligne avec deux entiers A et B.',
    outputFormat:'Six lignes, dans cet ordre : `A=...`, `B=...`, `C=...`, `D=...`, `E=...`, `F=...` (sans espace autour du signe =).',
    constraints:'0 ≤ A ≤ 10^6 ; 0 ≤ B ≤ 10^9.',
    explanation:'TD1 exercice 1. C = A+1 ≥ 1, donc la division et le modulo sont toujours définis.',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int A, B, C, D, E, F;
    scanf("%d %d", &A, &B);
    C = ++A;
    D = B--;
    E = D / C;
    D++;
    F = D % A;
    printf("A=%d\\nB=%d\\nC=%d\\nD=%d\\nE=%d\\nF=%d\\n", A, B, C, D, E, F);
    return 0;
}`)},cases,input=>{let [A,B]=input.trim().split(/\s+/).map(Number);A++;const Cv=A,D0=B;B--;const E=Math.trunc(D0/Cv),D=D0+1,F=D%A;
    return `A=${A}\nB=${B}\nC=${Cv}\nD=${D}\nE=${E}\nF=${F}`;});
}
{
  const cases=['-4 7\n','3 5\n','0 -8\n','-6 -9\n','1000000000 -1000000000\n','-1000000000 -1000000000\n','1000000000 999999999\n','0 0\n','-1 0\n',
    `${random(1,1e9)} ${-random(1,1e9)}\n`,`${-random(1,1e9)} ${random(1,1e9)}\n`,`${random(1,1e9)} ${random(1,1e9)}\n`];
  add(1,{slug:'td1-signe-produit',title:'Signe du produit',tags:['conditions'],
    statement:'On lit deux entiers **x** et **y**. Sans calculer le produit, déterminez son signe : `positif`, `negatif` ou `nul`.\n\nCalculer x × y dans un `int` déborde ici : |x × y| peut atteindre 10^18. Il faut raisonner sur les signes.',
    inputFormat:'Une ligne avec deux entiers x et y.',outputFormat:'Un seul mot : `positif` si x × y > 0, `negatif` si x × y < 0, `nul` si x × y = 0.',
    constraints:'-10^9 ≤ x, y ≤ 10^9.',explanation:'TD1 exercice 2, avec le cas nul traité à part.',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int x, y;
    scanf("%d %d", &x, &y);
    if (x == 0 || y == 0) printf("nul\\n");
    else if ((x < 0 && y > 0) || (x > 0 && y < 0)) printf("negatif\\n");
    else printf("positif\\n");
    return 0;
}`)},cases,input=>{const [x,y]=input.trim().split(/\s+/).map(Number);return x===0||y===0?'nul':(x<0)!==(y<0)?'negatif':'positif';});
}
{
  const cases=['12 + 30\n','7 / 2\n','-7 / 2\n','5 / 0\n','1000000000 * 1000000000\n','-1000000000 - 1000000000\n','0 * -5\n','9 - 15\n','-9 / -4\n','0 / 0\n',
    `${random(-1e9,1e9)} * ${random(-1e9,1e9)}\n`,`${random(-1e9,1e9)} / ${random(1,1000)}\n`];
  add(1,{slug:'td1-calculatrice',title:'Calculatrice',tags:['switch'],
    statement:'Écrivez une petite calculatrice : on lit un entier **a**, un opérateur **op** parmi `+`, `-`, `*`, `/`, puis un entier **b**, et on affiche le résultat de `a op b`.\n\nLa division est entière, comme en C : le quotient est tronqué vers zéro (`-7 / 2` donne `-3`). Si on divise par zéro, affichez `Erreur : division par zero`.',
    inputFormat:'Une ligne de la forme `a op b`, les trois éléments séparés par des espaces.',
    outputFormat:'Le résultat entier, ou le message `Erreur : division par zero`.',
    constraints:'-10^9 ≤ a, b ≤ 10^9. Le résultat peut dépasser la capacité d\'un `int` : utilisez `long long`.',
    explanation:'TD1 exercice 3 (switch sur l\'opérateur), en 64 bits.',
    solutionC:C(`#include <stdio.h>

int main(void) {
    long long a, b;
    char op;
    scanf("%lld %c %lld", &a, &op, &b);
    switch (op) {
        case '+': printf("%lld\\n", a + b); break;
        case '-': printf("%lld\\n", a - b); break;
        case '*': printf("%lld\\n", a * b); break;
        case '/':
            if (b != 0) printf("%lld\\n", a / b);
            else printf("Erreur : division par zero\\n");
            break;
    }
    return 0;
}`)},cases,input=>{const [a,op,b]=input.trim().split(/\s+/);const x=BigInt(a),y=BigInt(b);
    if(op==='/')return y===0n?'Erreur : division par zero':String(x/y);return String(op==='+'?x+y:op==='-'?x-y:x*y);});
}
{
  const cases=['7\n','10\n','0\n','-7\n','-4\n','1\n','-1\n','1000000000\n','-999999999\n',`${random(-1e9,1e9)}\n`,`${random(-1e9,1e9)}\n`,'2147\n'];
  add(1,{slug:'td1-pair-impair',title:'Pair ou impair',tags:['conditions','modulo'],
    statement:'On lit un entier **n**. Affichez `pair` si n est pair, `impair` sinon.\n\nAttention : n peut être négatif, et en C `-7 % 2` vaut `-1`, pas `1`.',
    inputFormat:'Une ligne avec l\'entier n.',outputFormat:'`pair` ou `impair`.',constraints:'-10^9 ≤ n ≤ 10^9.',
    explanation:'TD1 exercice 4 : tester n % 2 == 0 fonctionne aussi pour les négatifs.',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int n;
    scanf("%d", &n);
    if (n % 2 == 0) printf("pair\\n");
    else printf("impair\\n");
    return 0;
}`)},cases,input=>Number(input.trim())%2===0?'pair':'impair');
}
{
  const two=v=>String(v).padStart(2,'0');
  const cases=['05-03-2024\n','31-12-1999\n','1-1-2000\n','09-11-2026\n','15-08-1947\n','29-02-2000\n',
    ...Array.from({length:6},()=>`${random(0,1)?two(random(1,31)):random(1,31)}-${two(random(1,12))}-${random(1900,2100)}\n`)];
  add(1,{slug:'td1-lecture-date',title:'Lecture d\'une date',tags:['scanf'],
    statement:'Une date est saisie au format **jj-mm-aaaa** (les nombres sont séparés par des tirets, pas par des espaces). Lisez-la avec un seul `scanf` et affichez le jour, le mois et l\'année comme des entiers (sans zéro devant).',
    inputFormat:'Une ligne de la forme `jj-mm-aaaa`. Le jour et le mois peuvent avoir un ou deux chiffres.',
    outputFormat:'Trois lignes : `jour : J`, `mois : M`, `annee : A`.',constraints:'1 ≤ jour ≤ 31 ; 1 ≤ mois ≤ 12 ; 1900 ≤ annee ≤ 2100.',
    explanation:'TD1 exercice 5 (version 2) : le format "%d-%d-%d" consomme les tirets.',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int jour, mois, annee;
    scanf("%d-%d-%d", &jour, &mois, &annee);
    printf("jour : %d\\nmois : %d\\nannee : %d\\n", jour, mois, annee);
    return 0;
}`)},cases,input=>{const [j,m,a]=input.trim().split('-').map(Number);return `jour : ${j}\nmois : ${m}\nannee : ${a}`;});
}

// ================= TD2: boucles =================
{
  const harmonic=n=>{let s=0;for(let i=1;i<=n;i++)s+=1/i;return s;};
  // Values whose third decimal sits on a rounding edge would make float/double answers differ.
  const safe=n=>{const v=harmonic(n)*100;return Math.abs(v-Math.floor(v)-0.5)>1e-4;};
  const cases=['4\n','1\n'];
  for(const n of [2,3,10,100,1000,12345,100000])if(safe(n))cases.push(n+'\n');
  while(cases.length<TESTS){const n=random(5,100000);if(safe(n))cases.push(n+'\n');}
  add(2,{slug:'td2-serie-harmonique',title:'Série harmonique',tags:['boucles','reels'],
    statement:'Calculez la somme des **N** premiers termes de la série harmonique :\n\nS = 1 + 1/2 + 1/3 + … + 1/N\n\nAttention : `1/i` entre deux entiers vaut 0 en C. Écrivez `1.0 / i` et accumulez dans un `double`.',
    inputFormat:'Une ligne avec l\'entier N.',outputFormat:'La somme S avec exactement deux chiffres après la virgule (format `%.2f`).',
    constraints:'1 ≤ N ≤ 10^5.',explanation:'TD2 exercice 1, en double (un float perd de la précision pour les grands N).',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int n;
    double somme = 0.0;
    scanf("%d", &n);
    for (int i = 1; i <= n; i++) somme += 1.0 / i;
    printf("%.2f\\n", somme);
    return 0;
}`)},cases,input=>harmonic(Number(input.trim())).toFixed(2));
}
{
  const cases=['5\n2 4\n','1\n1 1\n','3\n3 3\n','4\n1 4\n','10\n10 1\n','50\n25 25\n','50\n1 1\n'];
  while(cases.length<TESTS){const n=random(2,50);cases.push(`${n}\n${random(1,n)} ${random(1,n)}\n`);}
  add(2,{slug:'td2-carre-case',title:'Case marquée dans un carré',tags:['boucles-imbriquees'],
    statement:'Dessinez un carré de **n × n** cases. Toutes les cases contiennent `.`, sauf la case de la ligne **x** et de la colonne **y**, qui contient `#`. Les lignes et les colonnes sont numérotées à partir de 1.',
    inputFormat:'La première ligne contient n. La deuxième contient x et y.',outputFormat:'n lignes de n caractères chacune, sans espace.',
    constraints:'1 ≤ n ≤ 50 ; 1 ≤ x, y ≤ n.',explanation:'TD2 exercice 2 : deux boucles imbriquées et un test sur (i, j).',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int n, x, y;
    scanf("%d %d %d", &n, &x, &y);
    for (int i = 1; i <= n; i++) {
        for (int j = 1; j <= n; j++) printf(i == x && j == y ? "#" : ".");
        printf("\\n");
    }
    return 0;
}`)},cases,input=>{const [n,x,y]=input.trim().split(/\s+/).map(Number);
    return Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i+1===x&&j+1===y?'#':'.').join('')).join('\n');});
}
{
  const cases=['4\n','1\n','2\n','9\n','10\n','12\n','20\n','30\n','50\n',`${random(3,49)}\n`,`${random(3,49)}\n`,'7\n'];
  add(2,{slug:'td2-triangle-nombres',title:'Triangle de nombres',checker:'TRIMMED_LINES',tags:['boucles-imbriquees'],
    statement:'Affichez un triangle de **n** lignes : la ligne **i** contient le nombre i écrit i fois, séparé par des espaces.\n\nPour n = 3 :\n\n```\n1\n2 2\n3 3 3\n```',
    inputFormat:'Une ligne avec l\'entier n.',outputFormat:'n lignes ; la ligne i contient i fois le nombre i, séparés par un espace.',
    constraints:'1 ≤ n ≤ 50.',explanation:'TD2 exercice 3. Les espaces en fin de ligne sont ignorés.',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int n;
    scanf("%d", &n);
    for (int i = 1; i <= n; i++) {
        for (int j = 1; j <= i; j++) printf("%d ", i);
        printf("\\n");
    }
    return 0;
}`)},cases,input=>{const n=Number(input.trim());return Array.from({length:n},(_,i)=>Array(i+1).fill(i+1).join(' ')).join('\n');});
}
{
  const cases=['3 4\n','1 1\n','1 10\n','10 1\n','10 10\n','30 30\n','5 7\n','12 3\n',`${random(2,30)} ${random(2,30)}\n`,`${random(2,30)} ${random(2,30)}\n`,`${random(2,30)} ${random(2,30)}\n`,'2 30\n'];
  add(2,{slug:'td2-table-multiplication',title:'Table de multiplication',checker:'TRIMMED_LINES',tags:['boucles-imbriquees'],
    statement:'Affichez la table de multiplication à **n** lignes et **m** colonnes : la case (i, j) contient i × j (1 ≤ i ≤ n, 1 ≤ j ≤ m). Ensuite, affichez la somme de toutes les cases de la table.',
    inputFormat:'Une ligne avec les entiers n et m.',outputFormat:'n lignes de m nombres séparés par des espaces, puis une dernière ligne avec la somme.',
    constraints:'1 ≤ n, m ≤ 30.',explanation:'TD2 exercice 4 : la somme vaut (n(n+1)/2) × (m(m+1)/2).',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int n, m, somme = 0;
    scanf("%d %d", &n, &m);
    for (int i = 1; i <= n; i++) {
        for (int j = 1; j <= m; j++) {
            printf("%d ", i * j);
            somme += i * j;
        }
        printf("\\n");
    }
    printf("%d\\n", somme);
    return 0;
}`)},cases,input=>{const [n,m]=input.trim().split(/\s+/).map(Number);let s=0;const rows=[];
    for(let i=1;i<=n;i++){const r=[];for(let j=1;j<=m;j++){r.push(i*j);s+=i*j;}rows.push(r.join(' '));}return rows.join('\n')+'\n'+s;});
}
{
  const cases=['4\n','1\n','2\n','3\n','5\n','8\n','10\n','15\n','25\n','40\n',`${random(6,39)}\n`,`${random(6,39)}\n`];
  add(2,{slug:'td2-triangle-etoiles',title:'Triangle isocèle d\'étoiles',checker:'TRIMMED_LINES',tags:['boucles-imbriquees'],
    statement:'Affichez un triangle isocèle de **N** lignes. La ligne i (1 ≤ i ≤ N) commence par N − i espaces, suivis de 2i − 1 étoiles `*`.\n\nPour N = 3 :\n\n```\n  *\n ***\n*****\n```\n\nLes espaces en début de ligne comptent ; les espaces en fin de ligne sont ignorés.',
    inputFormat:'Une ligne avec l\'entier N.',outputFormat:'Les N lignes du triangle.',constraints:'1 ≤ N ≤ 40.',
    explanation:'TD2 exercice 5 : une boucle pour les espaces, une boucle pour les étoiles.',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int n;
    scanf("%d", &n);
    for (int i = 1; i <= n; i++) {
        for (int j = 1; j <= n - i; j++) printf(" ");
        for (int k = 1; k <= 2 * i - 1; k++) printf("*");
        printf("\\n");
    }
    return 0;
}`)},cases,input=>{const n=Number(input.trim());return Array.from({length:n},(_,i)=>' '.repeat(n-i-1)+'*'.repeat(2*i+1)).join('\n');});
}

// ================= TD3: tableaux et matrices =================
{
  const mk=(a,x)=>`${a.length}\n${a.join(' ')}\n${x}\n`;
  const cases=[mk([4,9,1,9,3],9),mk([5,2,8],7),mk([3],3),mk([2,2,2],2),mk([-1,5,-1,0],-1),mk([0,0,1],0)];
  while(cases.length<TESTS){const a=array(random(5,100),-20,20);cases.push(mk(a,random(0,2)?pick(a):random(-30,30)));}
  add(3,{slug:'td3-tri-suppression',title:'Trier puis supprimer une valeur',checker:'TRIMMED_LINES',difficulty:'MEDIUM',tags:['tableaux','tri'],
    statement:'On lit un tableau de **n** entiers. Triez-le par ordre **décroissant** et affichez-le. Ensuite, on lit une valeur **x** : supprimez **toutes** ses occurrences du tableau trié (en décalant les éléments suivants) et affichez le tableau restant.\n\nSi le tableau devient vide, affichez `vide` sur la deuxième ligne.',
    inputFormat:'La première ligne contient n. La deuxième contient les n entiers. La troisième contient x.',
    outputFormat:'Deux lignes : le tableau trié par ordre décroissant, puis le tableau après suppression (ou `vide`). Les nombres sont séparés par des espaces.',
    constraints:'1 ≤ n ≤ 100 ; les valeurs et x sont entre -1000 et 1000.',
    explanation:'TD3 exercice 1 : tri par sélection, puis suppression avec décalage (penser à i-- après un décalage).',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int n, x, t[100];
    scanf("%d", &n);
    for (int i = 0; i < n; i++) scanf("%d", &t[i]);
    scanf("%d", &x);
    for (int i = 0; i < n - 1; i++)
        for (int j = i + 1; j < n; j++)
            if (t[i] < t[j]) { int tmp = t[i]; t[i] = t[j]; t[j] = tmp; }
    for (int i = 0; i < n; i++) printf("%d ", t[i]);
    printf("\\n");
    for (int i = 0; i < n; i++) {
        if (t[i] == x) {
            for (int j = i; j < n - 1; j++) t[j] = t[j + 1];
            n--;
            i--;
        }
    }
    if (n == 0) printf("vide");
    for (int i = 0; i < n; i++) printf("%d ", t[i]);
    printf("\\n");
    return 0;
}`)},cases,input=>{const l=lines(input);const a=l[1].trim().split(/\s+/).map(Number).sort((p,q)=>q-p),x=Number(l[2]);const b=a.filter(v=>v!==x);
    return a.join(' ')+'\n'+(b.length?b.join(' '):'vide');});
}
{
  const real=()=>{const v=random(-100000,100000)/100;return v.toFixed(2).replace(/\.?0+$/,'')||'0';};
  const mk=(n1,t2)=>`${n1} ${t2.length}\n${t2.join(' ')}\n`;
  const pos=t=>t.filter(v=>Number(v)>0).length;
  const cases=[mk(5,['3.5','-2','0','7.25','-1.5','4']),mk(3,['-1','-2.5']),mk(2,['1','2']),mk(1,['0']),mk(4,['0.01','-0.01','0','100'])];
  while(cases.length<TESTS){const t=Array.from({length:random(1,100)},real);cases.push(mk(Math.min(100,pos(t)+random(0,20)),t));}
  for(const c of cases){const [n1]=c.split(/\s+/).map(Number);assert.ok(pos(c.split('\n')[1].split(' '))<=n1);}
  add(3,{slug:'td3-copie-positifs',title:'Copier les éléments positifs',tags:['tableaux','reels'],
    statement:'On a deux tableaux de réels : **t1** de taille n1 et **t2** de taille n2. On lit les éléments de t2. Copiez dans t1, dans l\'ordre, les éléments **strictement positifs** de t2, puis complétez t1 avec des zéros. Affichez t1.',
    inputFormat:'La première ligne contient n1 et n2. La deuxième contient les n2 réels de t2.',
    outputFormat:'Les n1 éléments de t1 sur une ligne, chacun avec deux chiffres après la virgule (`%.2f`), séparés par des espaces.',
    constraints:'1 ≤ n1, n2 ≤ 100 ; -1000 ≤ t2[i] ≤ 1000, avec au plus deux chiffres après la virgule. t2 contient au plus n1 éléments strictement positifs.',
    explanation:'TD3 exercice 2 : un indice j pour t1, distinct de l\'indice de parcours de t2.',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int n1, n2, j = 0;
    float t1[100], t2[100];
    scanf("%d %d", &n1, &n2);
    for (int i = 0; i < n2; i++) scanf("%f", &t2[i]);
    for (int i = 0; i < n2; i++)
        if (t2[i] > 0) t1[j++] = t2[i];
    for (; j < n1; j++) t1[j] = 0;
    for (int i = 0; i < n1; i++) printf("%.2f ", t1[i]);
    printf("\\n");
    return 0;
}`)},cases,input=>{const l=lines(input);const n1=Number(l[0].split(' ')[0]);const p=l[1].trim().split(/\s+/).map(Number).filter(v=>v>0);
    while(p.length<n1)p.push(0);return p.map(v=>v.toFixed(2)).join(' ');});
}
{
  const mk=m=>`${m.length}\n${m.map(r=>r.join(' ')).join('\n')}\n`;
  const rnd=(n,lo,hi)=>Array.from({length:n},()=>array(n,lo,hi));
  const cases=[mk([[1,2,3],[4,5,6],[7,8,9]]),mk([[5,1],[2,7]]),mk([[42]]),mk(rnd(4,-9,9)),mk(rnd(5,0,0))];
  while(cases.length<TESTS)cases.push(mk(rnd(random(2,20),-1000,1000)));
  add(3,{slug:'td3-diagonale-nulle',title:'Mettre la diagonale à zéro',checker:'TRIMMED_LINES',tags:['matrices'],
    statement:'On lit une matrice carrée de taille **n × n**. Mettez à zéro tous les éléments de la **diagonale principale** (les cases (i, i)) puis affichez la matrice.',
    inputFormat:'La première ligne contient n. Les n lignes suivantes contiennent chacune n entiers.',
    outputFormat:'La matrice modifiée : n lignes de n entiers séparés par des espaces.',constraints:'1 ≤ n ≤ 20 ; |valeurs| ≤ 1000.',
    explanation:'TD3 exercice 3 : une seule boucle suffit pour la diagonale.',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int n, m[20][20];
    scanf("%d", &n);
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++) scanf("%d", &m[i][j]);
    for (int i = 0; i < n; i++) m[i][i] = 0;
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < n; j++) printf("%d ", m[i][j]);
        printf("\\n");
    }
    return 0;
}`)},cases,input=>{const l=lines(input);const n=Number(l[0]);
    return l.slice(1,n+1).map((r,i)=>r.trim().split(/\s+/).map((v,j)=>i===j?0:Number(v)).join(' ')).join('\n');});
}
{
  const mat=(r,c,lo,hi)=>Array.from({length:r},()=>array(c,lo,hi));
  const mk=(A,B)=>`${A.length} ${B.length} ${B[0].length}\n${A.map(r=>r.join(' ')).join('\n')}\n${B.map(r=>r.join(' ')).join('\n')}\n`;
  const cases=[mk([[1,2],[3,4]],[[5,6],[7,8]]),mk([[1,2,3]],[[1],[2],[3]]),mk([[2]],[[3]]),mk([[1],[2]],[[3,4,5]]),mk(mat(3,3,0,1),mat(3,3,0,1))];
  while(cases.length<TESTS-1){const n=random(1,20),m=random(1,20),l=random(1,20);cases.push(mk(mat(n,m,-100,100),mat(m,l,-100,100)));}
  cases.push(mk(mat(20,20,100,100),mat(20,20,-100,-100)));
  add(3,{slug:'td3-produit-matrices',title:'Produit de deux matrices',checker:'TRIMMED_LINES',difficulty:'MEDIUM',tags:['matrices'],
    statement:'On lit une matrice **A** de taille N × M et une matrice **B** de taille M × L. Calculez et affichez le produit **C = A × B**, de taille N × L :\n\nC[i][j] = A[i][0]×B[0][j] + A[i][1]×B[1][j] + … + A[i][M−1]×B[M−1][j]\n\nN\'oubliez pas d\'initialiser C à zéro avant d\'accumuler.',
    inputFormat:'La première ligne contient N, M et L. Viennent ensuite les N lignes de A (M entiers chacune), puis les M lignes de B (L entiers chacune).',
    outputFormat:'Les N lignes de C, chacune avec L entiers séparés par des espaces.',constraints:'1 ≤ N, M, L ≤ 20 ; |valeurs| ≤ 100.',
    explanation:'TD3 exercice 4 : trois boucles imbriquées, O(N·M·L).',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int n, m, l, a[20][20], b[20][20], c[20][20];
    scanf("%d %d %d", &n, &m, &l);
    for (int i = 0; i < n; i++)
        for (int j = 0; j < m; j++) scanf("%d", &a[i][j]);
    for (int i = 0; i < m; i++)
        for (int j = 0; j < l; j++) scanf("%d", &b[i][j]);
    for (int i = 0; i < n; i++)
        for (int j = 0; j < l; j++) {
            c[i][j] = 0;
            for (int k = 0; k < m; k++) c[i][j] += a[i][k] * b[k][j];
        }
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < l; j++) printf("%d ", c[i][j]);
        printf("\\n");
    }
    return 0;
}`)},cases,input=>{const t=input.trim().split(/\s+/).map(Number);const [n,m,l]=t;let k=3;
    const A=Array.from({length:n},()=>Array.from({length:m},()=>t[k++])),B=Array.from({length:m},()=>Array.from({length:l},()=>t[k++]));
    return A.map(r=>Array.from({length:l},(_,j)=>r.reduce((s,v,q)=>s+v*B[q][j],0)).join(' ')).join('\n');});
}
{
  const mk=a=>`${a.length}\n${a.join(' ')}\n`;
  const alt=n=>Array.from({length:n},(_,i)=>(i%2?-1:1)*random(1,1e9));
  const cases=[mk([3,-1,4,5,-2]),mk([1,-2,3,-4]),mk([7]),mk([0,0,0]),mk([-5,-6]),mk([5,0,5]),mk([-1,0,-1,2]),mk(alt(1000)),
    mk([...alt(999),0]),mk(array(1000,-1e9,1e9)),mk(array(50,-1,1)),mk(alt(10))];
  add(3,{slug:'td3-signes-adjacents',title:'Voisins de même signe',tags:['tableaux'],
    statement:'On lit un tableau de **n** entiers. Existe-t-il deux éléments **adjacents** (T[i] et T[i+1]) de **même signe** ? Deux nombres sont de même signe s\'ils sont tous les deux strictement positifs ou tous les deux strictement négatifs ; zéro n\'a pas de signe.',
    inputFormat:'La première ligne contient n. La deuxième contient les n entiers.',outputFormat:'`OUI` s\'il existe deux voisins de même signe, `NON` sinon.',
    constraints:'1 ≤ n ≤ 1000 ; -10^9 ≤ T[i] ≤ 10^9. Attention : T[i] × T[i+1] déborde d\'un int.',
    explanation:'TD3 exercice 5 : comparer les signes sans multiplier.',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int n, t[1000], trouve = 0;
    scanf("%d", &n);
    for (int i = 0; i < n; i++) scanf("%d", &t[i]);
    for (int i = 0; i < n - 1; i++)
        if ((t[i] > 0 && t[i + 1] > 0) || (t[i] < 0 && t[i + 1] < 0)) { trouve = 1; break; }
    printf(trouve ? "OUI\\n" : "NON\\n");
    return 0;
}`)},cases,input=>{const a=lines(input)[1].trim().split(/\s+/).map(Number);for(let i=0;i+1<a.length;i++)if((a[i]>0&&a[i+1]>0)||(a[i]<0&&a[i+1]<0))return 'OUI';return 'NON';});
}
{
  const mk=a=>`${a.length}\n${a.join(' ')}\n`;
  const cases=[mk([4,2,4,7,2,4]),mk([1,2,3]),mk([5]),mk([9,9,9,9]),mk([-1,1,-1,0,0]),mk(array(1000,1,10)),mk(array(1000,-1e9,1e9)),mk(array(1000,0,500))];
  while(cases.length<TESTS)cases.push(mk(array(random(2,200),-10,10)));
  add(3,{slug:'td3-valeurs-distinctes',title:'Valeurs distinctes',checker:'TRIMMED_LINES',tags:['tableaux'],
    statement:'On lit un tableau de **n** entiers. Affichez ses valeurs distinctes, dans l\'ordre de leur **première apparition**, puis leur nombre.',
    inputFormat:'La première ligne contient n. La deuxième contient les n entiers.',
    outputFormat:'Deux lignes : les valeurs distinctes séparées par des espaces, puis leur nombre.',constraints:'1 ≤ n ≤ 1000 ; -10^9 ≤ T[i] ≤ 10^9.',
    explanation:'TD3 exercice 6 : un second tableau des valeurs déjà vues, O(n²) suffit ici.',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int n, t[1000], distinct[1000], count = 0;
    scanf("%d", &n);
    for (int i = 0; i < n; i++) scanf("%d", &t[i]);
    for (int i = 0; i < n; i++) {
        int nouveau = 1;
        for (int j = 0; j < count; j++)
            if (t[i] == distinct[j]) { nouveau = 0; break; }
        if (nouveau) distinct[count++] = t[i];
    }
    for (int i = 0; i < count; i++) printf("%d ", distinct[i]);
    printf("\\n%d\\n", count);
    return 0;
}`)},cases,input=>{const d=[...new Set(lines(input)[1].trim().split(/\s+/).map(Number))];return d.join(' ')+'\n'+d.length;});
}

// ================= TD4: chaînes de caractères =================
const PRINTABLE=LOWER+'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?-_()';
const phrase=(maxLen,letters=PRINTABLE)=>{
  // Words of printable characters separated by one or more spaces; no space at either end.
  let s=word(1,8,letters);
  while(true){const next=' '.repeat(random(1,3)>2?random(2,3):1)+word(1,8,letters);if(s.length+next.length>maxLen)break;if(random(0,9)===0)break;s+=next;}
  return s;
};
{
  const cases=['Bonjour tout le monde\n','a\n','programmation en C\n','x'.repeat(100)+'\n','un  deux   trois\n','A,B;C.D!E?F\n'];
  while(cases.length<TESTS)cases.push(phrase(100)+'\n');
  add(4,{slug:'td4-longueur-chaine',title:'Longueur d\'une chaîne',tags:['chaines'],
    statement:'Lisez une ligne de texte et affichez son nombre de caractères, **sans utiliser `strlen`** : parcourez la chaîne jusqu\'au caractère `\\0`.\n\nLa ligne peut contenir des espaces : `scanf("%s")` ne lit qu\'un mot, utilisez `fgets` (et ne comptez pas le `\\n` final).',
    inputFormat:'Une ligne de texte (au moins un caractère, ni en début ni en fin de ligne d\'espace).',outputFormat:'La longueur de la ligne.',
    constraints:'1 ≤ longueur ≤ 100. Caractères ASCII imprimables.',explanation:'TD4 exercice 1. La fonction gets du corrigé n\'existe plus en C11 : fgets la remplace.',
    solutionC:C(`#include <stdio.h>
#include <string.h>

${READ_LINE}

int main(void) {
    char ch[200];
    int taille = 0;
    lireLigne(ch, sizeof ch);
    while (ch[taille] != '\\0') taille++;
    printf("%d\\n", taille);
    return 0;
}`)},cases,input=>lines(input)[0].length);
}
{
  const mk=a=>`${a.length}\n${a.join('\n')}\n`;
  const cases=[mk(['bonjour','abc def']),mk(['radar']),mk(['a','ab','abc']),mk(['Programmation en C']),mk(Array.from({length:10},()=>phrase(100)))];
  while(cases.length<TESTS)cases.push(mk(Array.from({length:random(1,10)},()=>phrase(100))));
  add(4,{slug:'td4-inverser-chaines',title:'Inverser des chaînes',checker:'TRIMMED_LINES',tags:['chaines'],
    statement:'On lit un nombre **nb**, puis **nb** lignes de texte. Inversez chaque ligne **sur place** (échangez le premier et le dernier caractère, puis le deuxième et l\'avant-dernier, etc.) et affichez-la.\n\nAprès `scanf("%d", &nb)`, le `\\n` reste dans le tampon : consommez-le avant de lire les lignes.',
    inputFormat:'La première ligne contient nb. Les nb lignes suivantes contiennent les chaînes (sans espace au début ni à la fin).',
    outputFormat:'nb lignes : chaque chaîne inversée.',constraints:'1 ≤ nb ≤ 10 ; chaque chaîne a entre 1 et 100 caractères.',
    explanation:'TD4 exercice 2 : deux indices i et j qui se rapprochent.',
    solutionC:C(`#include <stdio.h>
#include <string.h>

${READ_LINE}

int main(void) {
    int nb;
    char ch[200];
    scanf("%d", &nb);
    getchar();
    for (int n = 0; n < nb; n++) {
        lireLigne(ch, sizeof ch);
        for (int i = 0, j = (int)strlen(ch) - 1; i < j; i++, j--) {
            char aux = ch[i];
            ch[i] = ch[j];
            ch[j] = aux;
        }
        puts(ch);
    }
    return 0;
}`)},cases,input=>{const l=lines(input);return l.slice(1,1+Number(l[0])).map(s=>[...s].reverse().join('')).join('\n');});
}
{
  const cases=['bonjour tout le monde\n','abc\n','a b  c   d\n','Programmation en C\n',`${'x '.repeat(49)}x\n`];
  while(cases.length<TESTS)cases.push(phrase(100)+'\n');
  add(4,{slug:'td4-supprimer-espaces',title:'Supprimer les espaces',checker:'TRIMMED_LINES',tags:['chaines'],
    statement:'Lisez une ligne de texte. Comptez ses espaces, puis supprimez-les tous et affichez la chaîne obtenue.',
    inputFormat:'Une ligne de texte (sans espace au début ni à la fin).',outputFormat:'Deux lignes : le nombre d\'espaces, puis la chaîne sans espaces.',
    constraints:'1 ≤ longueur ≤ 100.',explanation:'TD4 exercice 3 (version 2) : recopier les caractères non espaces dans une seconde chaîne.',
    solutionC:C(`#include <stdio.h>
#include <string.h>

${READ_LINE}

int main(void) {
    char ch[200], resultat[200];
    int j = 0, espaces = 0;
    lireLigne(ch, sizeof ch);
    for (int i = 0; ch[i] != '\\0'; i++) {
        if (ch[i] == ' ') espaces++;
        else resultat[j++] = ch[i];
    }
    resultat[j] = '\\0';
    printf("%d\\n%s\\n", espaces, resultat);
    return 0;
}`)},cases,input=>{const s=lines(input)[0];return (s.split(' ').length-1)+'\n'+s.replace(/ /g,'');});
}
{
  const mk=(a,b,i)=>`${a}\n${b}\n${i}\n`;
  const cases=[mk('Bonjour monde','tout le ',8),mk('abc','XYZ',0),mk('abc','XYZ',3),mk('programmation C','en ',14),mk('a','b',1)];
  while(cases.length<TESTS){const a=phrase(100),b=phrase(100);cases.push(mk(a,b,random(0,a.length)));}
  add(4,{slug:'td4-inserer-chaine',title:'Insérer une chaîne',checker:'TRIMMED_LINES',tags:['chaines'],
    statement:'On lit une chaîne **ch**, une chaîne **ch2** et un indice **k**. Insérez ch2 dans ch à la position k (les caractères de ch à partir de l\'indice k sont décalés après ch2) et affichez le résultat. Les indices commencent à 0 ; k = longueur de ch ajoute ch2 à la fin.',
    inputFormat:'Trois lignes : ch, ch2, puis l\'entier k.',outputFormat:'La chaîne obtenue.',
    constraints:'1 ≤ longueur de ch, longueur de ch2 ≤ 100 ; 0 ≤ k ≤ longueur de ch. ch ne commence ni ne finit par un espace ; ch2 peut finir par un espace.',
    explanation:'TD4 exercice 4 : sauvegarder la fin de ch, copier ch2, puis recopier la fin, et terminer par \\0.',
    solutionC:C(`#include <stdio.h>
#include <string.h>

${READ_LINE}

int main(void) {
    char ch[300], ch2[200], fin[200];
    int k;
    lireLigne(ch, sizeof ch);
    lireLigne(ch2, sizeof ch2);
    scanf("%d", &k);
    strcpy(fin, ch + k);
    strcpy(ch + k, ch2);
    strcat(ch, fin);
    printf("%s\\n", ch);
    return 0;
}`)},cases,input=>{const l=lines(input);const k=Number(l[2]);return l[0].slice(0,k)+l[1]+l[0].slice(k);});
}
{
  const mk=(s,a,b)=>`${s}\n${a} ${b}\n`;
  const cases=[mk('Bonjour tout le monde',7,11),mk('abcdef',0,2),mk('abcdef',3,5),mk('ab',0,0),mk('ab',1,1),mk('programmation en C',0,13)];
  while(cases.length<TESTS){const s=phrase(100);if(s.length<2)continue;const a=random(0,s.length-1),b=random(a,s.length-1);if(b-a+1<s.length)cases.push(mk(s,a,b));}
  add(4,{slug:'td4-supprimer-sous-chaine',title:'Supprimer une sous-chaîne',checker:'TRIMMED_LINES',tags:['chaines'],
    statement:'On lit une chaîne **ch** et deux indices **a ≤ b**. Supprimez de ch les caractères des positions a à b **incluses** (en décalant la suite vers la gauche) et affichez le résultat. Les indices commencent à 0.',
    inputFormat:'La première ligne contient ch. La deuxième contient a et b.',outputFormat:'La chaîne après suppression.',
    constraints:'2 ≤ longueur de ch ≤ 100 ; 0 ≤ a ≤ b < longueur ; la chaîne obtenue n\'est jamais vide.',
    explanation:'TD4 exercice 4 (2) : ch[i] = ch[j] avec i à partir de a et j à partir de b+1.',
    solutionC:C(`#include <stdio.h>
#include <string.h>

${READ_LINE}

int main(void) {
    char ch[200];
    int a, b, i, j;
    lireLigne(ch, sizeof ch);
    scanf("%d %d", &a, &b);
    for (i = a, j = b + 1; ch[j] != '\\0'; i++, j++) ch[i] = ch[j];
    ch[i] = '\\0';
    printf("%s\\n", ch);
    return 0;
}`)},cases,input=>{const l=lines(input);const [a,b]=l[1].trim().split(/\s+/).map(Number);return l[0].slice(0,a)+l[0].slice(b+1);});
}

// ================= TD5: pointeurs et fonctions =================
{
  const cases=['10 5 1 2 3\n','0 0 0 0 0\n',...Array.from({length:10},()=>`${array(5,-1000,1000).join(' ')}\n`)];
  add(5,{slug:'td5-pointeurs',title:'Suivre un pointeur',tags:['pointeurs'],
    statement:'On lit deux entiers **a** et **b** et les trois éléments d\'un tableau `tab`. Exécutez exactement ce code et affichez `tab` après chaque modification :\n\n```c\nint *p_int;\n/* modification 1 */\ntab[0] = a;\n*(tab + 1) = b;\np_int = tab + 2;\n/* modification 2 */\n*p_int = *(p_int - 1);\np_int--;\n/* modification 3 */\n*p_int = *(p_int - 1);\np_int--;\n/* modification 4 */\n*p_int = *(p_int + 2);\n```',
    inputFormat:'Une ligne avec a, b, tab[0], tab[1] et tab[2].',outputFormat:'Quatre lignes : les trois éléments de tab après chacune des modifications 1 à 4.',
    constraints:'Toutes les valeurs sont entre -1000 et 1000.',explanation:'TD5 exercice 1, avec des valeurs lues au lieu des constantes.',
    solutionC:C(`#include <stdio.h>

int main(void) {
    int a, b, tab[3];
    int *p_int;
    scanf("%d %d %d %d %d", &a, &b, &tab[0], &tab[1], &tab[2]);
    tab[0] = a;
    *(tab + 1) = b;
    p_int = tab + 2;
    printf("%d %d %d\\n", tab[0], tab[1], tab[2]);
    *p_int = *(p_int - 1);
    p_int--;
    printf("%d %d %d\\n", tab[0], tab[1], tab[2]);
    *p_int = *(p_int - 1);
    p_int--;
    printf("%d %d %d\\n", tab[0], tab[1], tab[2]);
    *p_int = *(p_int + 2);
    printf("%d %d %d\\n", tab[0], tab[1], tab[2]);
    return 0;
}`)},cases,input=>{const [a,b,...t]=input.trim().split(/\s+/).map(Number);const out=[];t[0]=a;t[1]=b;let p=2;out.push(t.join(' '));
    t[p]=t[p-1];p--;out.push(t.join(' '));t[p]=t[p-1];p--;out.push(t.join(' '));t[p]=t[p+2];out.push(t.join(' '));return out.join('\n');});
}
{
  const mk=(x,y)=>`${x.length}\n${x.join(' ')}\n${y.length}\n${y.join(' ')}\n`;
  const same=array(1000,-1e9,1e9),other=[...same];other[999]++;
  const cases=[mk([1,2,3],[1,2,3]),mk([1,2,3],[1,2]),mk([4],[5]),mk([7],[7]),mk([1,2,3],[3,2,1]),mk(same,same),mk(same,other)];
  while(cases.length<TESTS){const x=array(random(1,50),-5,5);const y=random(0,1)?[...x]:array(x.length,-5,5);cases.push(mk(x,y));}
  add(5,{slug:'td5-tableaux-egaux',title:'Tableaux égaux',tags:['fonctions','allocation-dynamique'],
    statement:'Écrivez une fonction `int *saisie(int n)` qui alloue avec `malloc` un tableau de n entiers, le remplit et le renvoie, et une fonction `bool estEgal(int *t1, int *t2, int n, int m)`. Deux tableaux sont égaux s\'ils ont la même taille et les mêmes éléments aux mêmes positions.\n\nLisez deux tableaux et dites s\'ils sont égaux.',
    inputFormat:'La taille n du premier tableau, puis ses n éléments ; la taille m du second, puis ses m éléments.',
    outputFormat:'`egaux` ou `differents`.',constraints:'1 ≤ n, m ≤ 1000 ; -10^9 ≤ éléments ≤ 10^9.',
    explanation:'TD5 exercice 2 : comparer les tailles d\'abord, puis élément par élément.',
    solutionC:C(`#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>

int *saisie(int n) {
    int *t = malloc(n * sizeof(int));
    for (int i = 0; i < n; i++) scanf("%d", t + i);
    return t;
}

bool estEgal(int *t1, int *t2, int n, int m) {
    if (n != m) return false;
    for (int i = 0; i < n; i++)
        if (t1[i] != t2[i]) return false;
    return true;
}

int main(void) {
    int n, m;
    scanf("%d", &n);
    int *t1 = saisie(n);
    scanf("%d", &m);
    int *t2 = saisie(m);
    printf(estEgal(t1, t2, n, m) ? "egaux\\n" : "differents\\n");
    free(t1);
    free(t2);
    return 0;
}`)},cases,input=>{const l=lines(input);return l[0]===l[2]&&l[1].trim()===l[3].trim()?'egaux':'differents';});
}
{
  const mk=s=>s+'\n';
  const cases=[mk('le langage C est puissant'),mk('un'),mk('abc de fgh'),mk('aa  bbb   cc  ddd'),mk('   espaces au debut'),mk('x '.repeat(40)+'y')];
  while(cases.length<TESTS)cases.push(mk(sentence(random(1,30),1,12,()=>' '.repeat(random(1,3)))));
  add(5,{slug:'td5-mot-plus-long',title:'Le mot le plus long',tags:['chaines','pointeurs'],
    statement:'Lisez une phrase. Les mots sont séparés par un ou plusieurs espaces. Affichez le **mot le plus long** et sa longueur. S\'il y en a plusieurs de même longueur, affichez le **premier**.\n\nLe TD propose de découper la phrase avec des pointeurs : `nbre_mots`, `taille_mots`, puis un tableau de mots alloués dynamiquement.',
    inputFormat:'Une ligne de texte contenant au moins un mot (lettres minuscules).',outputFormat:'Le mot le plus long, un espace, puis sa longueur.',
    constraints:'Longueur de la ligne ≤ 200.',explanation:'TD5 exercice 3. Comparer avec < strict garde le premier mot en cas d\'égalité.',
    solutionC:C(`#include <stdio.h>
#include <string.h>

${READ_LINE}

int main(void) {
    char ch[300];
    char *p, *debut = NULL;
    int max = 0;
    lireLigne(ch, sizeof ch);
    p = ch;
    while (*p != '\\0') {
        if (*p != ' ' && (p == ch || *(p - 1) == ' ')) {
            char *q = p;
            while (*q != ' ' && *q != '\\0') q++;
            if (q - p > max) { max = (int)(q - p); debut = p; }
            p = q;
        } else {
            p++;
        }
    }
    printf("%.*s %d\\n", max, debut, max);
    return 0;
}`)},cases,input=>{const w=lines(input)[0].trim().split(/ +/);let best=w[0];for(const x of w)if(x.length>best.length)best=x;return best+' '+best.length;});
}
{
  const cases=['le langage c est puissant\n','zebre\n','b a c\n','pomme pomme poire\n','abc ab a\n','  deux  espaces  \n'];
  while(cases.length<TESTS)cases.push(sentence(random(2,40),1,10,()=>' '.repeat(random(1,2)))+'\n');
  add(5,{slug:'td5-tri-mots',title:'Trier les mots',difficulty:'MEDIUM',tags:['chaines','pointeurs','tri'],
    statement:'Lisez une phrase et affichez ses mots triés par **ordre alphabétique** (l\'ordre de `strcmp`), un par ligne. Les mots sont séparés par un ou plusieurs espaces ; les doublons sont gardés.\n\nAstuce du TD : avec un tableau `char **mots`, il suffit d\'échanger les **pointeurs**, sans recopier les chaînes.',
    inputFormat:'Une ligne de texte contenant au moins un mot (lettres minuscules).',outputFormat:'Les mots triés, un par ligne.',
    constraints:'Longueur de la ligne ≤ 200.',explanation:'TD5 exercice 4 (version 2) : tri par échange de pointeurs.',
    solutionC:C(`#include <stdio.h>
#include <string.h>

${READ_LINE}

int main(void) {
    char ch[300];
    char *mots[200];
    int n = 0;
    lireLigne(ch, sizeof ch);
    for (char *m = strtok(ch, " "); m != NULL; m = strtok(NULL, " ")) mots[n++] = m;
    for (int i = 0; i < n - 1; i++)
        for (int j = i + 1; j < n; j++)
            if (strcmp(mots[i], mots[j]) > 0) { char *tmp = mots[i]; mots[i] = mots[j]; mots[j] = tmp; }
    for (int i = 0; i < n; i++) printf("%s\\n", mots[i]);
    return 0;
}`)},cases,input=>lines(input)[0].trim().split(/ +/).sort((a,b)=>a<b?-1:a>b?1:0).join('\n'));
}
{
  const mk=(a,b)=>`${a}\n${b}\n`;
  const cases=[mk('programmation en C','program'),mk('programmation en C','gram'),mk('abc','abc'),mk('ab','abc'),mk('Bonjour','bonjour'),mk('le C','le '),mk('x','x')];
  while(cases.length<TESTS){const a=phrase(100);cases.push(mk(a,random(0,1)?a.slice(0,random(1,a.length)):phrase(20)));}
  add(5,{slug:'td5-debute-par',title:'Commence par',tags:['chaines','fonctions'],
    statement:'Écrivez une fonction `int debute_par(char *chaine1, char *chaine2)` qui renvoie 1 si chaine1 **commence par** chaine2, 0 sinon (indice : `strncmp`). Lisez les deux chaînes et affichez la réponse. Les majuscules et les minuscules sont différentes.',
    inputFormat:'Deux lignes : chaine1 puis chaine2.',outputFormat:'`OUI` si chaine1 commence par chaine2, `NON` sinon.',
    constraints:'1 ≤ longueurs ≤ 100. chaine2 peut finir par un espace.',explanation:'TD5 exercice 5 : strncmp(chaine1, chaine2, strlen(chaine2)) == 0.',
    solutionC:C(`#include <stdio.h>
#include <string.h>

${READ_LINE}

int debute_par(char *chaine1, char *chaine2) {
    return strncmp(chaine1, chaine2, strlen(chaine2)) == 0;
}

int main(void) {
    char chaine1[200], chaine2[200];
    lireLigne(chaine1, sizeof chaine1);
    lireLigne(chaine2, sizeof chaine2);
    printf(debute_par(chaine1, chaine2) ? "OUI\\n" : "NON\\n");
    return 0;
}`)},cases,input=>{const l=lines(input);return l[0].startsWith(l[1])?'OUI':'NON';});
}
{
  const mk=(a,b)=>`${a}\n${b}\n`;
  const cases=[mk('programmation en C','en'),mk('programmation en C','Java'),mk('aaaa','aa'),mk('abc','abc'),mk('abc','abcd'),mk('le C le C','C'),mk('banane','ane')];
  while(cases.length<TESTS){const a=phrase(100,'ab');const i=random(0,a.length-1);cases.push(mk(a,random(0,2)?a.slice(i,Math.min(a.length,i+random(1,5))).trim()||'a':word(3,6,'ab')));}
  add(5,{slug:'td5-presence-sous-chaine',title:'Position d\'une sous-chaîne',tags:['chaines','fonctions'],
    statement:'Écrivez une fonction `int presence(char *chaine1, char *chaine2)` qui renvoie la position de la **première occurrence** de chaine2 dans chaine1, ou -1 si chaine2 n\'y apparaît pas (indice : `strstr` et une différence de pointeurs). Les positions commencent à 0.',
    inputFormat:'Deux lignes : chaine1 puis chaine2.',outputFormat:'La position de la première occurrence, ou -1.',
    constraints:'1 ≤ longueurs ≤ 100.',explanation:'TD5 exercice 6 : pos - chaine1 quand strstr ne renvoie pas NULL.',
    solutionC:C(`#include <stdio.h>
#include <string.h>

${READ_LINE}

int presence(char *chaine1, char *chaine2) {
    char *pos = strstr(chaine1, chaine2);
    return pos ? (int)(pos - chaine1) : -1;
}

int main(void) {
    char chaine1[200], chaine2[200];
    lireLigne(chaine1, sizeof chaine1);
    lireLigne(chaine2, sizeof chaine2);
    printf("%d\\n", presence(chaine1, chaine2));
    return 0;
}`)},cases,input=>{const l=lines(input);return l[0].indexOf(l[1]);});
}

// ================= TD6: fichiers (le contenu du fichier arrive sur l'entrée standard) =================
{
  const cases=['bonjour le monde fin\n','fin\n','un\ndeux\ntrois\nfin\nquatre\n','alpha beta fin gamma fin\n','finale final fin\n',
    Array.from({length:500},()=>word(1,10)).filter(w=>w!=='fin').join(' ')+' fin\n'];
  while(cases.length<TESTS)cases.push(Array.from({length:random(1,60)},()=>word(1,6,'finabc')).filter(w=>w!=='fin').join(random(0,1)?' ':'\n')+'\nfin\n'+(random(0,1)?sentence(5)+'\n':''));
  add(6,{slug:'td6-mots-jusqua-fin',title:'Enregistrer des mots jusqu\'à « fin »',tags:['fichiers','chaines'],
    statement:'Au TD, le programme écrit dans un fichier chaque mot saisi, jusqu\'au mot `fin`. Ici, le « fichier » est la sortie : lisez des mots un par un (`scanf("%s")`) jusqu\'au mot `fin` (non compris) et affichez chacun sur sa ligne. Terminez par le nombre de mots enregistrés.\n\nTout ce qui suit `fin` est ignoré.',
    inputFormat:'Des mots séparés par des espaces ou des retours à la ligne. Le mot `fin` apparaît au moins une fois.',
    outputFormat:'Les mots avant le premier `fin`, un par ligne, puis une ligne avec leur nombre.',
    constraints:'Au plus 1000 mots, de 1 à 20 lettres minuscules chacun.',explanation:'TD6 exercice 1 : strcmp(mot, "fin") == 0 arrête la boucle.',
    solutionC:C(`#include <stdio.h>
#include <string.h>

int main(void) {
    char mot[100];
    int n = 0;
    while (scanf("%99s", mot) == 1 && strcmp(mot, "fin") != 0) {
        printf("%s\\n", mot);
        n++;
    }
    printf("%d\\n", n);
    return 0;
}`)},cases,input=>{const w=input.trim().split(/\s+/);const k=w.indexOf('fin');return [...w.slice(0,k),k].join('\n');});
}
{
  const text=()=>Array.from({length:random(1,15)},()=>random(0,5)?sentence(random(1,10),1,8,()=>' '.repeat(random(1,2))):'').join('\n')+'\n';
  const cases=['m\nLe langage C\nest puissant\n','c\nabc\nde\n','l\nune\ndeux\n\nquatre\n','c\n\n\n','m\n   \n  a  b \n','l\nseule ligne\n'];
  for(const ch of ['c','m','l','c','m','l'])cases.push(ch+'\n'+text());
  add(6,{slug:'td6-compter-texte',title:'Caractères, mots ou lignes',difficulty:'MEDIUM',tags:['fichiers'],
    statement:'Le TD compte les caractères, les mots ou les lignes d\'un fichier. Ici, la première ligne de l\'entrée contient une lettre de choix, et **toutes les lignes suivantes** forment le contenu du fichier :\n\n- `c` : le nombre de caractères du contenu, **sans compter** les retours à la ligne ;\n- `m` : le nombre de mots (suites de caractères séparées par des espaces ou des retours à la ligne) ;\n- `l` : le nombre de lignes du contenu.\n\nLisez le contenu avec `fgetc`, `fscanf` ou `fgets` sur `stdin` comme vous le feriez sur un fichier.',
    inputFormat:'La première ligne contient `c`, `m` ou `l`. Les lignes suivantes sont le contenu ; chacune se termine par un retour à la ligne.',
    outputFormat:'Le nombre demandé.',constraints:'Au plus 100 lignes de contenu, chacune d\'au plus 90 caractères. Le contenu peut contenir des lignes vides.',
    explanation:'TD6 exercice 3 sur stdin : fgetc pour c, fscanf("%s") pour m, fgets pour l.',
    solutionC:C(`#include <stdio.h>

int main(void) {
    char choix, ligne[200], mot[200];
    int count = 0, c;
    scanf(" %c", &choix);
    while ((c = getchar()) != '\\n' && c != EOF) { }
    if (choix == 'c') {
        while ((c = getchar()) != EOF)
            if (c != '\\n' && c != '\\r') count++;
    } else if (choix == 'm') {
        while (scanf("%199s", mot) == 1) count++;
    } else {
        while (fgets(ligne, sizeof ligne, stdin) != NULL) count++;
    }
    printf("%d\\n", count);
    return 0;
}`)},cases,input=>{const i=input.indexOf('\n');const ch=input[0],body=input.slice(i+1);
    if(ch==='c')return body.replace(/\n/g,'').length;if(ch==='m')return body.split(/\s+/).filter(Boolean).length;return body.split('\n').length-1;});
}

// ---------- write ----------
const order={};
for(const p of problems){order[p.td]=(order[p.td]??0)+1;p.tdOrder=order[p.td];}
for(const entry of fs.readdirSync(root,{withFileTypes:true}))if(entry.isDirectory())fs.rmSync(path.join(root,entry.name),{recursive:true,force:true});
for(const p of problems) {
  const dir=path.join(root,p.slug);
  fs.mkdirSync(path.join(dir,'tests'),{recursive:true});
  const metadata={...p,referenceLanguage:'C',referenceFile:'solution.c',
    source:`Exercice du TD${p.td} (Correction des TD), réécrit pour le juge InfoM4th`,
    tests:p.tests.map((t,i)=>({input:`tests/${String(i+1).padStart(2,'0')}.in`,expected:`tests/${String(i+1).padStart(2,'0')}.out`,sample:i<2}))};
  delete metadata.solutionC;
  fs.writeFileSync(path.join(dir,'problem.json'),JSON.stringify(metadata,null,2)+'\n');
  fs.writeFileSync(path.join(dir,'solution.c'),p.solutionC);
  for(const [i,t] of p.tests.entries()) {
    const stem=String(i+1).padStart(2,'0');
    fs.writeFileSync(path.join(dir,'tests',stem+'.in'),t.input);
    fs.writeFileSync(path.join(dir,'tests',stem+'.out'),t.expected);
  }
}
fs.writeFileSync(path.join(root,'index.json'),JSON.stringify(problems.map(p=>p.slug),null,2)+'\n');
const table=problems.map(p=>`| TD${p.td} | ${p.title} | ${p.difficulty} | ${p.checker} |`).join('\n');
fs.writeFileSync(path.join(root,'README.md'),`# TD problem bank (academic)

${problems.length} judged problems made from the C exercises of TD1 to TD6 ("Correction des TD"), ${problems.length*TESTS} tests:
2 examples and ${TESTS-2} hidden tests each. Statements are in French, like the TDs. Reference solutions are C
(\`solution.c\`, adapted from the corrections: no prompts, fgets instead of gets); expected outputs come from
independent oracles in \`generate.mjs\`.

The file exercises of TD6 read the "file" from standard input. TD6 exercise 2 (copy a file) has no
judged version: with stdin it is only an echo.

| TD | Problem | Level | Checker |
| --- | --- | --- | --- |
${table}

## Regenerate, verify, package

Run from the repository root:

\`\`\`text
node examples/td-problems/generate.mjs
node examples/td-problems/verify.mjs --cc gcc
node scripts/package-problem-bank.mjs examples/td-problems backend/src/main/resources/seed/td-problems.json
\`\`\`

The backend bundles \`seed/td-problems.json.gz\` and installs every problem by itself (import, validate the
reference on the judge, approve) into the **TD** section, grouped by TD number. Set
\`CP_SEED_TD_PROBLEMS=false\` to turn this off.
`);
console.log(`Wrote ${problems.length} problems, ${problems.length*TESTS} tests.`);
