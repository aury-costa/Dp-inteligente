
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, push, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
apiKey: "YOUR_KEY",
authDomain: "dp-inteligente.firebaseapp.com",
databaseURL:"https://dp-inteligente-default-rtdb.firebaseio.com/",
projectId: "dp-inteligente",
storageBucket: "dp-inteligente.firebasestorage.app"
};

const app = initializeApp(firebaseConfig);

export const db = getDatabase(app)
export const storage = getStorage(app)
export {ref,push,onValue,sRef,uploadBytes,getDownloadURL}
