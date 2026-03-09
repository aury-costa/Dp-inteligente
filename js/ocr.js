
export function extrairNome(texto){

const regras=[
/atesto\s+para\s+(.*)/i,
/sr\.?\s+(.*)/i,
/sr\(a\)\.?\s+(.*)/i,
/paciente\s+(.*)/i,
/funcion[aá]rio\s+(.*)/i
]

for(const r of regras){
const m=texto.match(r)
if(m){
let nome=m[1]
.replace(/[0-9]/g,'')
.replace(/portador.*/i,'')
.replace(/cpf.*/i,'')
.trim()

if(nome.length>5)return nome
}
}

return ""
}

export function extrairCPF(texto){
const cpf=texto.match(/\d{3}\.?\d{3}\.?\d{3}\-?\d{2}/)
return cpf?cpf[0]:""
}

export function extrairData(texto){
const d=texto.match(/\d{2}\/\d{2}\/\d{2,4}/)
return d?d[0]:""
}
