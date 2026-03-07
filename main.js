import {
  auth,
  db,
  storage,
  ref,
  push,
  set,
  update,
  onValue,
  get,
  storageRef,
  uploadBytes,
  getDownloadURL,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "./firebase.js";

const state = {
  user: null,
  docs: [],
  audit: [],
  employees: [],
  selectedSignatureDocId: null,
  currentExtractedText: "",
  currentPreviewUrl: "",
  unsubscribers: []
};

const viewsMeta = {
  dashboard: ["Dashboard", "Resumo de pendências e alertas do DP."],
  capture: ["Digitalizar", "Scanner com OCR automático e indexação."],
  archive: ["Arquivo Geral", "Busca mágica dentro de todo o acervo."],
  signatures: ["Assinaturas", "Fila de assinatura eletrônica do DP."],
  employees: ["Colaboradores", "Visão agrupada por colaborador sem criar pastas."],
  audit: ["Auditoria", "Rastreio completo de ações por documento."]
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '-';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('pt-BR') : '-';
const lower = (v) => (v || '').toString().toLowerCase();
const escapeHtml = (s='') => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

const signatureCanvas = $('#signatureCanvas');
const signaturePad = new window.SignaturePad(signatureCanvas, { minWidth: 1.1, maxWidth: 2.4 });
resizeSignatureCanvas();
window.addEventListener('resize', resizeSignatureCanvas);

function resizeSignatureCanvas() {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const rect = signatureCanvas.getBoundingClientRect();
  signatureCanvas.width = rect.width * ratio;
  signatureCanvas.height = 280 * ratio;
  signatureCanvas.getContext('2d').scale(ratio, ratio);
  signaturePad.clear();
}

function showMainView(view) {
  $$('.page-view').forEach(v => v.classList.add('hidden'));
  $(`#${view}View`).classList.remove('hidden');
  $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  $('#viewTitle').textContent = viewsMeta[view][0];
  $('#viewSubtitle').textContent = viewsMeta[view][1];
}

function initNav() {
  $$('.nav-btn').forEach(btn => btn.addEventListener('click', () => showMainView(btn.dataset.view)));
  $('#refreshBtn').addEventListener('click', () => {
    renderAll();
    notify('Tela atualizada.', 'ok');
  });
  $('#globalSearchTop').addEventListener('input', (e) => {
    $('#archiveSearch').value = e.target.value;
    showMainView('archive');
    renderArchive();
  });
}

function notify(message, kind = 'info') {
  const el = $('#uploadStatus');
  const cls = kind === 'error' ? 'danger' : kind === 'ok' ? 'ok' : 'warn';
  el.innerHTML = `<span class="chip ${cls}">${kind === 'error' ? 'Erro' : kind === 'ok' ? 'OK' : 'Info'}</span> <div style="margin-top:10px">${escapeHtml(message)}</div>`;
}

function detectDocType(text) {
  const t = lower(text);
  if (t.includes('atestado')) return 'Atestado';
  if (t.includes('licença') || t.includes('licenca')) return 'Licença';
  if (t.includes('férias') || t.includes('ferias')) return 'Férias';
  if (t.includes('advertência') || t.includes('advertencia')) return 'Advertência';
  if (t.includes('rescis')) return 'Rescisão';
  if (t.includes('admiss')) return 'Admissão';
  if (t.includes('exame')) return 'Exame';
  return 'Outro';
}

function detectEmployeeName(text) {
  const lines = text.split(/\n+/).map(v => v.trim()).filter(Boolean);
  const patterns = [
    /(?:colaborador|funcion[aá]rio|empregado|nome)\s*[:\-]\s*([A-ZÀ-Ú][A-Za-zÀ-ú' ]{4,})/i,
    /(?:paciente)\s*[:\-]\s*([A-ZÀ-Ú][A-Za-zÀ-ú' ]{4,})/i,
    /eu,\s*([A-ZÀ-Ú][A-Za-zÀ-ú' ]{4,})/i
  ];
  for (const p of patterns) {
    const match = text.match(p);
    if (match?.[1]) return normalizeName(match[1]);
  }
  const candidate = lines
    .map(l => normalizeName(l))
    .find(l => /\b[A-ZÀ-Ú][a-zà-ú']+\s+[A-ZÀ-Ú][a-zà-ú']+/.test(l) && l.length < 55 && !/atestado|médico|empresa|cpf|rg|cid|crm/i.test(l));
  return candidate || 'Não identificado';
}

function normalizeName(name='') {
  return name
    .replace(/\s+/g,' ')
    .replace(/[^A-Za-zÀ-ú' ]/g,'')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function detectCPF(text) {
  const m = text.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
  return m ? m[0] : '';
}

function detectDate(text) {
  const m = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (!m) return '';
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}

async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdfjsLib = window.pdfjsLib || globalThis.pdfjsLib;
  if (!pdfjsLib) throw new Error('PDF.js não carregado');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/build/pdf.worker.min.mjs';
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  const pages = Math.min(pdf.numPages, 3);
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text.trim();
}

async function extractTextFromImage(file) {
  const result = await window.Tesseract.recognize(file, 'por+eng', {
    logger: (m) => {
      if (m.status) notify(`${m.status} ${m.progress ? `(${Math.round(m.progress * 100)}%)` : ''}`);
    }
  });
  return result.data.text || '';
}

function fillOcrFields(text) {
  const employee = detectEmployeeName(text);
  const cpf = detectCPF(text);
  const date = detectDate(text);
  const type = $('#docType').value || detectDocType(text);
  $('#ocrEmployee').textContent = employee || '-';
  $('#ocrCpf').textContent = cpf || '-';
  $('#ocrType').textContent = type || '-';
  $('#ocrDate').textContent = date ? fmtDate(date) : '-';
  $('#ocrText').value = text;
  state.currentExtractedText = text;
  if (!$('#docDate').value && date) $('#docDate').value = date;
  if (!$('#docType').value) $('#docType').value = type;
}

async function previewAndReadFile(file) {
  const preview = $('#previewWrap');
  const objectUrl = URL.createObjectURL(file);
  state.currentPreviewUrl = objectUrl;
  preview.classList.remove('empty');
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    preview.innerHTML = `<embed src="${objectUrl}" type="application/pdf" height="420" />`;
  } else {
    preview.innerHTML = `<img src="${objectUrl}" alt="Prévia" />`;
  }
  notify('Lendo documento...');
  let text = '';
  if (file.type.startsWith('image/')) text = await extractTextFromImage(file);
  else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) text = await extractTextFromPdf(file);
  fillOcrFields(text);
  notify('Leitura concluída. Revise os dados e salve.', 'ok');
}

function scoreDoc(doc, q) {
  if (!q) return 1;
  const query = lower(q);
  let score = 0;
  if (lower(doc.employeeName).includes(query)) score += 10;
  if (lower(doc.cpf).includes(query)) score += 9;
  if (lower(doc.type).includes(query)) score += 7;
  if (lower(doc.fileName).includes(query)) score += 5;
  if (lower(doc.extractedText).includes(query)) score += 4;
  if (lower(doc.notes).includes(query)) score += 2;
  return score;
}

async function logAudit(action, doc = null, extra = {}) {
  if (!state.user) return;
  const payload = {
    action,
    docId: doc?.id || extra.docId || '',
    fileName: doc?.fileName || extra.fileName || '',
    employeeName: doc?.employeeName || extra.employeeName || '',
    userUid: state.user.uid,
    userEmail: state.user.email,
    userName: state.user.displayName || state.user.email,
    timestamp: Date.now(),
    ...extra
  };
  await push(ref(db, 'auditLogs'), payload);
}

async function uploadDocumentRecord(file, dataUrlSignature = '') {
  const uid = crypto.randomUUID();
  const filePath = `documentos/${uid}_${file.name.replace(/\s+/g, '_')}`;
  const sRef = storageRef(storage, filePath);
  await uploadBytes(sRef, file);
  const fileUrl = await getDownloadURL(sRef);

  let signatureUrl = '';
  if (dataUrlSignature) {
    const blob = await (await fetch(dataUrlSignature)).blob();
    const signRef = storageRef(storage, `assinaturas/${uid}.png`);
    await uploadBytes(signRef, blob);
    signatureUrl = await getDownloadURL(signRef);
  }

  const extractedText = $('#ocrText').value.trim();
  const employeeName = $('#ocrEmployee').textContent === '-' ? detectEmployeeName(extractedText) : $('#ocrEmployee').textContent;
  const payload = {
    fileName: file.name,
    fileUrl,
    storagePath: filePath,
    employeeName,
    cpf: $('#ocrCpf').textContent === '-' ? detectCPF(extractedText) : $('#ocrCpf').textContent,
    type: $('#docType').value || detectDocType(extractedText),
    documentDate: $('#docDate').value || detectDate(extractedText) || '',
    expiryDate: $('#expiryDate').value || '',
    extractedText,
    requiresSignature: $('#requiresSignature').value === 'true',
    signatureStatus: $('#requiresSignature').value === 'true' ? (dataUrlSignature ? 'assinado' : 'pendente_assinatura') : 'arquivado',
    signatureUrl,
    notes: $('#notes').value.trim(),
    uploadedBy: state.user.email,
    uploadedAt: Date.now(),
    lastActionAt: Date.now()
  };
  const docRef = push(ref(db, 'documents'));
  await set(docRef, payload);
  await logAudit('upload', { id: docRef.key, ...payload });
  notify('Documento salvo com sucesso.', 'ok');
  clearUploadForm();
}

function clearUploadForm() {
  $('#uploadForm').reset();
  $('#ocrText').value = '';
  ['#ocrEmployee','#ocrCpf','#ocrType','#ocrDate'].forEach(id => $(id).textContent = '-');
  $('#previewWrap').className = 'preview-wrap empty';
  $('#previewWrap').textContent = 'Nenhum arquivo selecionado.';
  state.currentExtractedText = '';
}

function computeStatus(doc) {
  if (doc.signatureStatus === 'pendente_assinatura') return ['Pendente assinatura', 'warn'];
  if (doc.expiryDate) {
    const now = new Date();
    const exp = new Date(doc.expiryDate + 'T23:59:59');
    const diffDays = Math.ceil((exp - now) / 86400000);
    if (diffDays < 0) return ['Vencido', 'danger'];
    if (diffDays <= 7) return [`Vence em ${diffDays} dia(s)`, 'warn'];
  }
  if (doc.signatureStatus === 'assinado') return ['Assinado', 'ok'];
  return ['Arquivado', 'ok'];
}

function renderDashboard() {
  const docs = state.docs;
  $('#statTotal').textContent = docs.length;
  $('#statPendingSign').textContent = docs.filter(d => d.signatureStatus === 'pendente_assinatura').length;
  $('#statExpiring').textContent = docs.filter(d => {
    if (!d.expiryDate) return false;
    const diff = Math.ceil((new Date(d.expiryDate + 'T23:59:59') - new Date()) / 86400000);
    return diff >= 0 && diff <= 7;
  }).length;
  $('#statExpired').textContent = docs.filter(d => d.expiryDate && (new Date(d.expiryDate + 'T23:59:59') < new Date())).length;

  const recent = [...docs].sort((a,b)=>b.uploadedAt-a.uploadedAt).slice(0,8);
  $('#recentDocs').innerHTML = recent.length ? recent.map(doc => `
    <div class="item-card">
      <h4>${escapeHtml(doc.fileName)}</h4>
      <p><span class="tag-strong">${escapeHtml(doc.employeeName || 'Não identificado')}</span> · ${escapeHtml(doc.type || 'Outro')}</p>
      <p>${fmtDateTime(doc.uploadedAt)}</p>
    </div>`).join('') : `<div class="empty-state">Nenhum documento ainda.</div>`;

  const alerts = [...docs]
    .filter(d => d.expiryDate)
    .map(d => ({...d, diff: Math.ceil((new Date(d.expiryDate + 'T23:59:59') - new Date()) / 86400000)}))
    .sort((a,b)=>a.diff-b.diff)
    .slice(0,8);
  $('#alertsList').innerHTML = alerts.length ? alerts.map(doc => {
    const cls = doc.diff < 0 ? 'danger' : doc.diff <= 7 ? 'warn' : 'ok';
    const msg = doc.diff < 0 ? `Vencido há ${Math.abs(doc.diff)} dia(s)` : `Vence em ${doc.diff} dia(s)`;
    return `<div class="item-card"><h4>${escapeHtml(doc.employeeName || 'Não identificado')}</h4><p>${escapeHtml(doc.type)}</p><p><span class="chip ${cls}">${msg}</span></p></div>`;
  }).join('') : `<div class="empty-state">Sem alertas de vencimento.</div>`;
}

function buildDocCard(doc) {
  const tpl = $('#docCardTemplate').content.cloneNode(true);
  const [statusText, statusClass] = computeStatus(doc);
  tpl.querySelector('.doc-name').textContent = doc.fileName;
  tpl.querySelector('.doc-sub').textContent = `${doc.employeeName || 'Não identificado'} · ${doc.type || 'Outro'}`;
  tpl.querySelector('.doc-status').textContent = statusText;
  tpl.querySelector('.doc-status').classList.add(statusClass);
  tpl.querySelector('.doc-snippet').textContent = doc.extractedText?.slice(0, 220) || 'Sem texto indexado.';
  tpl.querySelector('.doc-meta').innerHTML = `
    <span class="chip">${escapeHtml(doc.type || 'Outro')}</span>
    <span class="chip">CPF: ${escapeHtml(doc.cpf || '-')}</span>
    <span class="chip">Doc: ${doc.documentDate ? fmtDate(doc.documentDate) : '-'}</span>
    <span class="chip">Validade: ${doc.expiryDate ? fmtDate(doc.expiryDate) : '-'}</span>`;
  const actions = tpl.querySelector('.doc-actions');

  const openBtn = document.createElement('button');
  openBtn.className = 'btn secondary';
  openBtn.textContent = 'Abrir';
  openBtn.onclick = async () => {
    window.open(doc.fileUrl, '_blank');
    await logAudit('open', doc);
  };

  const dlBtn = document.createElement('button');
  dlBtn.className = 'btn secondary';
  dlBtn.textContent = 'Baixar';
  dlBtn.onclick = async () => {
    const a = document.createElement('a');
    a.href = doc.fileUrl;
    a.target = '_blank';
    a.download = doc.fileName;
    a.click();
    await logAudit('download', doc);
  };

  const signBtn = document.createElement('button');
  signBtn.className = 'btn primary';
  signBtn.textContent = 'Assinar';
  signBtn.onclick = async () => {
    state.selectedSignatureDocId = doc.id;
    showMainView('signatures');
    renderSignatureQueue();
  };

  actions.append(openBtn, dlBtn);
  if (doc.signatureStatus === 'pendente_assinatura') actions.append(signBtn);
  return tpl;
}

function renderArchive() {
  const q = $('#archiveSearch').value.trim();
  const type = $('#archiveTypeFilter').value;
  const status = $('#archiveStatusFilter').value;
  const docs = [...state.docs]
    .filter(doc => !type || doc.type === type)
    .filter(doc => !status || doc.signatureStatus === status)
    .map(doc => ({ doc, score: scoreDoc(doc, q) }))
    .filter(item => item.score > 0)
    .sort((a,b)=> b.score - a.score || b.doc.uploadedAt - a.doc.uploadedAt)
    .map(item => item.doc);

  const target = $('#archiveResults');
  target.innerHTML = '';
  if (!docs.length) {
    target.innerHTML = `<div class="empty-state">Nenhum documento encontrado.</div>`;
    return;
  }
  docs.forEach(doc => target.appendChild(buildDocCard(doc)));
}

function renderSignatureQueue() {
  const pending = state.docs.filter(d => d.signatureStatus === 'pendente_assinatura').sort((a,b)=>b.uploadedAt-a.uploadedAt);
  const target = $('#signatureQueue');
  target.innerHTML = pending.length ? '' : `<div class="empty-state">Nenhum documento pendente de assinatura.</div>`;
  pending.forEach(doc => {
    const div = document.createElement('div');
    div.className = 'item-card';
    div.innerHTML = `<h4>${escapeHtml(doc.fileName)}</h4><p>${escapeHtml(doc.employeeName || 'Não identificado')} · ${escapeHtml(doc.type)}</p><p>${fmtDateTime(doc.uploadedAt)}</p>`;
    const btn = document.createElement('button');
    btn.className = 'btn primary';
    btn.textContent = 'Selecionar';
    btn.onclick = () => {
      state.selectedSignatureDocId = doc.id;
      $('#selectedSignatureDoc').innerHTML = `<strong>${escapeHtml(doc.fileName)}</strong><br><span class="muted">${escapeHtml(doc.employeeName || 'Não identificado')} · ${escapeHtml(doc.type)}</span>`;
    };
    div.appendChild(btn);
    target.appendChild(div);
  });

  const selected = state.docs.find(d => d.id === state.selectedSignatureDocId);
  $('#selectedSignatureDoc').innerHTML = selected ? `<strong>${escapeHtml(selected.fileName)}</strong><br><span class="muted">${escapeHtml(selected.employeeName || 'Não identificado')} · ${escapeHtml(selected.type)}</span>` : 'Nenhum documento selecionado.';
}

function groupEmployees() {
  const map = new Map();
  state.docs.forEach(doc => {
    const name = (doc.employeeName || 'Não identificado').trim();
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(doc);
  });
  return [...map.entries()].map(([name, docs]) => ({ name, docs })).sort((a,b)=>a.name.localeCompare(b.name));
}

function renderEmployees() {
  const q = lower($('#employeeSearch').value.trim());
  state.employees = groupEmployees();
  const list = state.employees.filter(e => lower(e.name).includes(q));
  const target = $('#employeeList');
  target.innerHTML = list.length ? '' : `<div class="empty-state">Nenhum colaborador encontrado.</div>`;
  list.forEach(emp => {
    const div = document.createElement('div');
    div.className = 'employee-item';
    div.innerHTML = `<h4>${escapeHtml(emp.name)}</h4><p>${emp.docs.length} documento(s)</p>`;
    div.onclick = () => renderEmployeeProfile(emp.name);
    target.appendChild(div);
  });
}

function renderEmployeeProfile(name) {
  const docs = state.docs.filter(d => (d.employeeName || 'Não identificado') === name).sort((a,b)=>b.uploadedAt-a.uploadedAt);
  const cpf = docs.find(d => d.cpf)?.cpf || '-';
  const pending = docs.filter(d => d.signatureStatus === 'pendente_assinatura').length;
  const profile = $('#employeeProfile');
  profile.innerHTML = `
    <div class="profile-head">
      <div>
        <h3 style="margin:0">${escapeHtml(name)}</h3>
        <p class="muted" style="margin:6px 0 0">CPF: ${escapeHtml(cpf)} · ${docs.length} documento(s)</p>
      </div>
      <span class="chip ${pending ? 'warn' : 'ok'}">${pending ? `${pending} pendente(s)` : 'Tudo em dia'}</span>
    </div>
    <div class="cards-grid" id="employeeDocs"></div>`;
  const wrap = profile.querySelector('#employeeDocs');
  docs.forEach(doc => wrap.appendChild(buildDocCard(doc)));
}

function renderAudit() {
  const target = $('#auditLog');
  const items = [...state.audit].sort((a,b)=>b.timestamp-a.timestamp).slice(0,150);
  target.innerHTML = items.length ? items.map(item => `
    <div class="log-item">
      <h4 style="margin:0 0 6px">${escapeHtml(item.action)}</h4>
      <p>${escapeHtml(item.userName || item.userEmail || '-')} · ${fmtDateTime(item.timestamp)}</p>
      <p>Documento: ${escapeHtml(item.fileName || '-')} ${item.employeeName ? `· Colaborador: ${escapeHtml(item.employeeName)}` : ''}</p>
    </div>`).join('') : `<div class="empty-state">Sem logs ainda.</div>`;
}

function renderAll() {
  renderDashboard();
  renderArchive();
  renderSignatureQueue();
  renderEmployees();
  renderAudit();
}

function bindArchiveFilters() {
  ['#archiveSearch','#archiveTypeFilter','#archiveStatusFilter'].forEach(id => $(id).addEventListener('input', renderArchive));
  $('#employeeSearch').addEventListener('input', renderEmployees);
}

function subscribeData() {
  state.unsubscribers.forEach(fn => fn?.());
  state.unsubscribers = [];

  const docsRef = ref(db, 'documents');
  const unsubDocs = onValue(docsRef, snap => {
    const items = [];
    snap.forEach(child => items.push({ id: child.key, ...child.val() }));
    state.docs = items;
    renderAll();
  });

  const auditRef = ref(db, 'auditLogs');
  const unsubAudit = onValue(auditRef, snap => {
    const items = [];
    snap.forEach(child => items.push({ id: child.key, ...child.val() }));
    state.audit = items;
    renderAudit();
  });

  state.unsubscribers.push(unsubDocs, unsubAudit);
}

async function saveSignatureForSelected() {
  if (!state.selectedSignatureDocId) {
    alert('Selecione um documento pendente primeiro.');
    return;
  }
  if (signaturePad.isEmpty()) {
    alert('Desenhe a assinatura antes de salvar.');
    return;
  }
  const doc = state.docs.find(d => d.id === state.selectedSignatureDocId);
  if (!doc) return;
  const dataUrl = signaturePad.toDataURL('image/png');
  const blob = await (await fetch(dataUrl)).blob();
  const signRef = storageRef(storage, `assinaturas/${doc.id}.png`);
  await uploadBytes(signRef, blob);
  const signatureUrl = await getDownloadURL(signRef);
  await update(ref(db, `documents/${doc.id}`), {
    signatureStatus: 'assinado',
    signatureUrl,
    signedBy: state.user.email,
    signedAt: Date.now(),
    lastActionAt: Date.now()
  });
  await logAudit('sign', doc);
  signaturePad.clear();
  state.selectedSignatureDocId = null;
  notify('Documento assinado com sucesso.', 'ok');
}

function initAuth() {
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, $('#loginEmail').value.trim(), $('#loginPassword').value);
    } catch (err) {
      alert(getFriendlyFirebaseError(err));
    }
  });

  $('#registerBtn').addEventListener('click', async () => {
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    if (!email || !password) return alert('Preencha e-mail e senha para criar o acesso.');
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const name = email.split('@')[0].replace(/[._-]/g,' ');
      await updateProfile(cred.user, { displayName: normalizeName(name) });
      alert('Acesso criado com sucesso.');
    } catch (err) {
      alert(getFriendlyFirebaseError(err));
    }
  });

  $('#logoutBtn').addEventListener('click', async () => { await signOut(auth); });

  onAuthStateChanged(auth, async (user) => {
    state.user = user;
    if (user) {
      $('#authView').classList.add('hidden');
      $('#mainViews').classList.remove('hidden');
      $('#userCard').classList.remove('hidden');
      $('#userName').textContent = user.displayName || 'Equipe DP';
      $('#userEmail').textContent = user.email || '-';
      subscribeData();
      showMainView('dashboard');
      await logAudit('login', null);
    } else {
      $('#authView').classList.remove('hidden');
      $('#mainViews').classList.add('hidden');
      $('#userCard').classList.add('hidden');
      state.docs = [];
      state.audit = [];
    }
  });
}

function getFriendlyFirebaseError(err) {
  const code = err?.code || '';
  if (code.includes('invalid-credential')) return 'Login inválido. Verifique e-mail e senha.';
  if (code.includes('email-already-in-use')) return 'Este e-mail já está em uso.';
  if (code.includes('weak-password')) return 'Senha fraca. Use pelo menos 6 caracteres.';
  if (code.includes('network-request-failed')) return 'Falha de rede. Verifique a internet.';
  return err?.message || 'Erro inesperado no Firebase.';
}

function initUploadFlow() {
  $('#docFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await previewAndReadFile(file);
    } catch (err) {
      console.error(err);
      notify(`Falha ao ler arquivo: ${err.message}`, 'error');
    }
  });

  $('#clearUploadBtn').addEventListener('click', clearUploadForm);

  $('#uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = $('#docFile').files?.[0];
    if (!file) return alert('Selecione um arquivo.');
    try {
      await uploadDocumentRecord(file);
    } catch (err) {
      console.error(err);
      notify(`Erro ao salvar documento: ${err.message}`, 'error');
    }
  });
}

function initSignatureActions() {
  $('#clearSignatureBtn').addEventListener('click', () => signaturePad.clear());
  $('#saveSignatureBtn').addEventListener('click', saveSignatureForSelected);
}

initNav();
initAuth();
initUploadFlow();
bindArchiveFilters();
initSignatureActions();
