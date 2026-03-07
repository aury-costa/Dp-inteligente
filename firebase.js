
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getDatabase, ref, push, onValue } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-storage.js";

const firebaseConfig = {
apiKey: "AIzaSyDyyNMPnoGsjexbkdrwBVWegTWDHgxpt-c",
authDomain: "dp-inteligente.firebaseapp.com",
projectId: "dp-inteligente",
storageBucket: "dp-inteligente.firebasestorage.app",
messagingSenderId: "855910162288",
appId: "1:855910162288:web:7320ee7eafe9671ade39b5",
measurementId: "G-W0S9Q3FBL7"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const storage = getStorage(app);
export { ref, push, onValue, sRef, uploadBytes, getDownloadURL };
