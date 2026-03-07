
import { db, storage, ref, push, onValue, sRef, uploadBytes, getDownloadURL } from "./firebase.js";

window.show = function(id){
document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
document.getElementById(id).classList.remove("hidden");
}

window.upload = async function(){
const files = document.getElementById("fileInput").files;
for(let f of files){

const storageRef = sRef(storage, "docs/"+Date.now()+"_"+f.name);
await uploadBytes(storageRef,f);
const url = await getDownloadURL(storageRef);

push(ref(db,"documentos"),{
nome:f.name,
url:url,
data:Date.now()
});

document.getElementById("uploadStatus").innerHTML += "<p>"+f.name+" enviado</p>";
}
}

window.buscar = function(){
const termo = document.getElementById("busca").value.toLowerCase();
const res = document.getElementById("resultados");
res.innerHTML="";

onValue(ref(db,"documentos"), snap=>{
res.innerHTML="";
snap.forEach(doc=>{
const d=doc.val();
if(d.nome.toLowerCase().includes(termo)){
res.innerHTML += `<div><a href="${d.url}" target="_blank">${d.nome}</a></div>`;
}
})
})
}
