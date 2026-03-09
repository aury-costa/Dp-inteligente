
import {db,storage,ref,push,onValue,sRef,uploadBytes,getDownloadURL} from "./firebase.js"
import {extrairNome,extrairCPF,extrairData} from "./ocr.js"

const pages=document.querySelectorAll(".page")
document.querySelectorAll(".sidebar button").forEach(btn=>{
btn.onclick=()=>{
pages.forEach(p=>p.classList.add("hidden"))
document.getElementById(btn.dataset.page).classList.remove("hidden")
}
})

let currentFile=null

document.getElementById("fileInput").onchange=e=>{
currentFile=e.target.files[0]
previewFile(currentFile)
}

function previewFile(file){
const reader=new FileReader()
reader.onload=e=>{
document.getElementById("preview").innerHTML=`<img src="${e.target.result}">`
}
reader.readAsDataURL(file)
}

document.getElementById("scanBtn").onclick=async()=>{

if(!currentFile)return alert("Selecione arquivo")

const worker=Tesseract.createWorker()

await worker.load()
await worker.loadLanguage('por')
await worker.initialize('por')

const {data}=await worker.recognize(currentFile)

const texto=data.text.toLowerCase()

document.getElementById("nome").value=extrairNome(texto)
document.getElementById("cpf").value=extrairCPF(texto)
document.getElementById("data").value=extrairData(texto)

if(texto.includes("atestado"))
document.getElementById("tipo").value="Atestado"

await worker.terminate()

}

document.getElementById("saveDoc").onclick=async()=>{

if(!currentFile)return

const storageRef=sRef(storage,"docs/"+Date.now()+"_"+currentFile.name)

await uploadBytes(storageRef,currentFile)

const url=await getDownloadURL(storageRef)

push(ref(db,"docs"),{
nome:document.getElementById("nome").value,
cpf:document.getElementById("cpf").value,
tipo:document.getElementById("tipo").value,
data:document.getElementById("data").value,
url:url
})

push(ref(db,"logs"),{
acao:"upload",
data:Date.now()
})

alert("Documento salvo")

}

document.getElementById("search").oninput=e=>{

const t=e.target.value.toLowerCase()

onValue(ref(db,"docs"),snap=>{

let html=""

snap.forEach(doc=>{

const d=doc.val()

if(
d.nome?.toLowerCase().includes(t)||
d.cpf?.includes(t)||
d.tipo?.toLowerCase().includes(t)
){

html+=`<div>
<b>${d.nome}</b><br>
${d.tipo}<br>
<a href="${d.url}" target="_blank">Abrir</a>
</div>`
}

})

document.getElementById("results").innerHTML=html

})

}
