import {
  auth, db, storage, ref, push, set, update, onValue, get,
  storageRef, uploadBytes, getDownloadURL,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "./firebase.js";

const pdfjsLib = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/build/pdf.min.mjs");
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/build/pdf.worker.min.mjs";

const state = {
  user: null,
  profile: null,
  docs: [],
  audit: [],
  selectedSignatureDocId: null,
  currentExtractedText: "",
  currentFile: null,
  currentPreviewUrl: ""
};

const viewsMeta = {
  dashboard: ["Dashboard", "Resumo de pendências e alertas do DP."],
  capture: ["Digitalizar", "Scanner com OCR automático e indexação."],
  archive: ["Arquivo Geral", "Busca mágica dentro do acervo."],
  signatures: ["Assinaturas", "Fila de assinatura eletrônica do DP."],
  employees: ["Colaboradores", "Visão agrupada por colaborador sem criar pastas."],
  audit: ["Auditoria", "Rastreio completo de ações por documento."],
  trash: ["Lixeira", "Exclusão lógica com restauração."],
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const lower = (v) => (v || "").toString().toLowerCase();
const fmtDate = (d) => d ? new Date(d + (String(d).includes('T') ? '' : 'T12:00:00')).toLocaleDateString('pt-BR') : '-';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('pt-BR') : '-';
const daysDiff = (dateStr) => Math.ceil((new Date(dateStr + 'T23:59:59').getTime() - Date.now()) / 86400000);
const escapeHtml = (s='') => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const isAdmin = () => (state.profile?.role || 'admin') === 'admin';

const signatureCanvas = $('#signatureCanvas');
const signaturePad = new window.SignaturePad(signatureCanvas, { minWidth: 1.1, maxWidth: 2.4 });
resizeSignatureCanvas();
window.addEventListener('resize', resizeSignatureCanvas);

function resizeSignatureCanvas() {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const rect = signatureCanvas.getBoundingClientRect();
  signatureCanvas.width = rect.width * ratio;
  signatureCanvas.height = 280 * ratio;
  const ctx = signatureCanvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  signaturePad.clear();
}

function notify(message, kind='info') {
  $('#uploadStatus').innerHTML = `<span class="chip ${kind}">${kind === 'error' ? 'Erro' : kind === 'ok' ? 'OK' : 'Info'}</span><div style="margin-top:10px">${escapeHtml(message)}</div>`;
}

function normalizeName(name='') {
  return name.replace(/\s+/g, ' ').replace(/[^A-Za-zÀ-ú' ]/g, '').trim().split(' ').filter(Boolean).map(w => w[0].toUpperCase()+w.slice(1).toLowerCase()).join(' ');
}

function detectDocType(text='') {
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

function detectEmployeeName(text='') {
  const lines = text.split(/\n+/).map(v => v.trim()).filter(Boolean);
  const patterns = [
    /(?:colaborador|funcion[aá]rio|empregado|nome|paciente)\s*[:\-]\s*([A-ZÀ-Ú][A-Za-zÀ-ú' ]{4,})/i,
    /eu,\s*([A-ZÀ-Ú][A-Za-zÀ-ú' ]{4,})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return normalizeName(m[1]);
  }
  const candidate = lines.map(normalizeName).find(l => /\b[A-ZÀ-Ú][a-zà-ú']+\s+[A-ZÀ-Ú][a-zà-ú']+/.test(l) && l.length < 60 && !/atestado|médico|empresa|cpf|rg|cid|crm|cl[ií]nica|hospital/i.test(l));
  return candidate || 'Não identificado';
}

function detectCPF(text='') {
  return text.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/)?.[0] || '';
}

function detectDate(text='') {
  const m = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (!m) return '';
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}

function fillOcrFields(text='') {
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

async function extractTextFromImageBlob(blob) {
  const result = await window.Tesseract.recognize(blob, 'por+eng', {
    logger: m => { if (m.status) notify(`${m.status}${m.progress ? ` (${Math.round(m.progress * 100)}%)` : ''}`); }
  });
  return result.data.text || '';
}

async function extractTextFromImage(file) {
  return extractTextFromImageBlob(file);
}

async function renderPdfPageToBlob(pdf, pageNumber, scale = 1.7) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 1));
}

async function extractTextFromPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  let text = '';
  const pages = Math.min(pdf.numPages, 2);
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ').trim();
    text += pageText + '\n';
  }
  if (text.trim().length >= 20) return text.trim();
  notify('PDF sem texto embutido. Aplicando OCR nas páginas...');
  let ocrText = '';
  for (let i = 1; i <= pages; i++) {
    const blob = await renderPdfPageToBlob(pdf, i);
    ocrText += await extractTextFromImageBlob(blob);
    ocrText += '\n';
  }
  return ocrText.trim();
}

async function previewAndReadFile(file) {
  state.currentFile = file;
  if (state.currentPreviewUrl) URL.revokeObjectURL(state.currentPreviewUrl);
  const url = URL.createObjectURL(file);
  state.currentPreviewUrl = url;
  const preview = $('#previewWrap');
  preview.classList.remove('empty');
  if (file.type.startsWith('image/')) preview.innerHTML = `<img src="${url}" alt="Prévia" />`;
  else preview.innerHTML = `<iframe src="${url}"></iframe>`;
  notify('Lendo documento...');
  const text = file.type.startsWith('image/') ? await extractTextFromImage(file) : await extractTextFromPdf(file);
  fillOcrFields(text);
  notify('Leitura concluída. Revise os dados e salve.', 'ok');
}

function scoreDoc(doc, q) {
  if (!q) return 1;
  const terms = lower(q).split(/\s+/).filter(Boolean);
  const source = `${doc.employeeName} ${doc.cpf} ${doc.type} ${doc.fileName} ${doc.extractedText} ${doc.notes}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower(doc.employeeName).includes(term)) score += 12;
    if (lower(doc.cpf).includes(term)) score += 10;
    if (lower(doc.type).includes(term)) score += 8;
    if (lower(doc.fileName).includes(term)) score += 6;
    if (source.includes(term)) score += 3;
  }
  return score;
}

async function logAudit(action, doc = null, extra = {}) {
  if (!state.user) return;
  await push(ref(db, 'auditLogs'), {
    action,
    docId: doc?.id || extra.docId || '',
    fileName: doc?.fileName || extra.fileName || '',
    employeeName: doc?.employeeName || extra.employeeName || '',
    userUid: state.user.uid,
    userEmail: state.user.email,
    userName: state.profile?.name || state.user.displayName || state.user.email,
    timestamp: Date.now(),
    ...extra,
  });
}

async function ensureProfile(user) {
  const userRef = ref(db, `users/${user.uid}`);
  const snap = await get(userRef);
  const base = {
    email: user.email,
    name: user.displayName || normalizeName((user.email || 'Equipe DP').split('@')[0].replace(/[._-]/g,' ')),
    role: 'admin',
    active: true,
    createdAt: Date.now(),
  };
  if (!snap.exists()) await set(userRef, base);
  else await update(userRef, { email: user.email, name: base.name });
  const finalSnap = await get(userRef);
  state.profile = finalSnap.val() || base;
  $('#userName').textContent = state.profile.name || 'Equipe DP';
  $('#userEmail').textContent = state.profile.email || user.email || '-';
  $('#userRole').textContent = (state.profile.role || 'admin').toUpperCase();
  $('#userAvatar').textContent = (state.profile.name || 'DP').split(' ').slice(0,2).map(v => v[0]).join('').toUpperCase();
  $$('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin()));
}

async function uploadDocumentRecord(file) {
  const uid = crypto.randomUUID();
  const safeName = file.name.replace(/\s+/g, '_');
  const filePath = `documentos/${uid}_${safeName}`;
  const sRef = storageRef(storage, filePath);
  await uploadBytes(sRef, file);
  const fileUrl = await getDownloadURL(sRef);
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
    signatureStatus: $('#requiresSignature').value === 'true' ? 'pendente_assinatura' : 'arquivado',
    signatureUrl: '',
    notes: $('#notes').value.trim(),
    uploadedBy: state.user.email,
    uploadedAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
    deletedBy: '',
  };
  const docRef = push(ref(db, 'documents'));
  await set(docRef, payload);
  await logAudit('upload', { id: docRef.key, ...payload });
  clearUploadForm();
  notify('Documento salvo com sucesso.', 'ok');
}

function clearUploadForm() {
  $('#uploadForm').reset();
  $('#ocrText').value = '';
  ['#ocrEmployee','#ocrCpf','#ocrType','#ocrDate'].forEach(id => $(id).textContent = '-');
  $('#previewWrap').className = 'preview-wrap empty';
  $('#previewWrap').innerHTML = 'Nenhum arquivo selecionado.';
  state.currentExtractedText = '';
  state.currentFile = null;
  if (state.currentPreviewUrl) URL.revokeObjectURL(state.currentPreviewUrl);
  state.currentPreviewUrl = '';
}

function showMainView(view) {
  $$('.page-view').forEach(v => v.classList.add('hidden'));
  $(`#${view}View`).classList.remove('hidden');
  $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  $('#viewTitle').textContent = viewsMeta[view][0];
  $('#viewSubtitle').textContent = viewsMeta[view][1];
}

function computeStatus(doc) {
  if (doc.deletedAt) return ['Na lixeira', 'danger'];
  if (doc.signatureStatus === 'pendente_assinatura') return ['Pendente assinatura', 'warn'];
  if (doc.expiryDate) {
    const diff = daysDiff(doc.expiryDate);
    if (diff < 0) return [`Vencido há ${Math.abs(diff)} dia(s)`, 'danger'];
    if (diff <= 7) return [`Vence em ${diff} dia(s)`, 'warn'];
  }
  if (doc.signatureStatus === 'assinado') return ['Assinado', 'ok'];
  return ['Arquivado', 'info'];
}

function buildDocCard(doc, opts = {}) {
  const tpl = $('#docCardTemplate').content.cloneNode(true);
  const [statusText, statusClass] = computeStatus(doc);
  tpl.querySelector('.doc-name').textContent = doc.fileName;
  tpl.querySelector('.doc-sub').textContent = `${doc.employeeName || 'Não identificado'} · ${doc.type || 'Outro'}`;
  tpl.querySelector('.doc-status').textContent = statusText;
  tpl.querySelector('.doc-status').classList.add(statusClass);
  tpl.querySelector('.doc-snippet').textContent = (doc.extractedText || 'Sem texto indexado.').slice(0, 240);
  tpl.querySelector('.doc-meta').innerHTML = `
    <span class="chip">${escapeHtml(doc.type || 'Outro')}</span>
    <span class="chip">CPF: ${escapeHtml(doc.cpf || '-')}</span>
    <span class="chip">Doc: ${doc.documentDate ? fmtDate(doc.documentDate) : '-'}</span>
    <span class="chip">Validade: ${doc.expiryDate ? fmtDate(doc.expiryDate) : '-'}</span>`;
  const actions = tpl.querySelector('.doc-actions');

  const openBtn = button('Abrir', 'secondary', async () => {
    window.open(doc.fileUrl, '_blank', 'noopener,noreferrer');
    await logAudit('open', doc);
  });
  const dlBtn = button('Baixar', 'secondary', async () => {
    const a = document.createElement('a');
    a.href = doc.fileUrl; a.download = doc.fileName; a.target = '_blank'; a.click();
    await logAudit('download', doc);
  });
  actions.append(openBtn, dlBtn);

  if (!doc.deletedAt && doc.signatureStatus === 'pendente_assinatura') {
    actions.append(button('Assinar', 'primary', () => {
      state.selectedSignatureDocId = doc.id;
      showMainView('signatures');
      renderSignatureQueue();
    }));
  }
  if (!doc.deletedAt && isAdmin()) {
    actions.append(button('Editar', 'secondary', () => openEditModal(doc)));
    actions.append(button('Excluir', 'danger', () => moveToTrash(doc)));
  }
  if (opts.inTrash && isAdmin()) {
    actions.append(button('Restaurar', 'primary', () => restoreDoc(doc)));
  }
  return tpl;
}

function button(label, cls, onClick) {
  const btn = document.createElement('button');
  btn.className = `btn ${cls}`;
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function getActiveDocs() { return state.docs.filter(d => !d.deletedAt); }
function getTrashDocs() { return state.docs.filter(d => !!d.deletedAt); }

function renderDashboard() {
  const docs = getActiveDocs();
  $('#statTotal').textContent = docs.length;
  $('#statPendingSign').textContent = docs.filter(d => d.signatureStatus === 'pendente_assinatura').length;
  $('#statExpiring').textContent = docs.filter(d => d.expiryDate && daysDiff(d.expiryDate) >= 0 && daysDiff(d.expiryDate) <= 7).length;
  $('#statExpired').textContent = docs.filter(d => d.expiryDate && daysDiff(d.expiryDate) < 0).length;

  const recent = [...docs].sort((a,b)=>b.uploadedAt-a.uploadedAt).slice(0,8);
  $('#recentDocs').innerHTML = recent.length ? recent.map(doc => `
    <div class="item-card"><h4>${escapeHtml(doc.fileName)}</h4><p><span class="chip info">${escapeHtml(doc.employeeName || 'Não identificado')}</span> · ${escapeHtml(doc.type || 'Outro')}</p><p>${fmtDateTime(doc.uploadedAt)}</p></div>`).join('') : `<div class="empty-state">Nenhum documento ainda.</div>`;

  const alerts = [...docs].filter(d => d.expiryDate).map(d => ({...d, diff: daysDiff(d.expiryDate)})).sort((a,b)=>a.diff-b.diff).slice(0,8);
  $('#alertsList').innerHTML = alerts.length ? alerts.map(doc => {
    const cls = doc.diff < 0 ? 'danger' : doc.diff <= 7 ? 'warn' : 'ok';
    const msg = doc.diff < 0 ? `Vencido há ${Math.abs(doc.diff)} dia(s)` : `Vence em ${doc.diff} dia(s)`;
    return `<div class="item-card"><h4>${escapeHtml(doc.employeeName || 'Não identificado')}</h4><p>${escapeHtml(doc.type || 'Outro')}</p><p><span class="chip ${cls}">${msg}</span></p></div>`;
  }).join('') : `<div class="empty-state">Sem alertas de vencimento.</div>`;
}

function renderArchive() {
  const q = $('#archiveSearch').value.trim();
  const type = $('#archiveTypeFilter').value;
  const status = $('#archiveStatusFilter').value;
  const docs = getActiveDocs()
    .filter(d => !type || d.type === type)
    .filter(d => !status || d.signatureStatus === status)
    .map(doc => ({ doc, score: scoreDoc(doc, q) }))
    .filter(item => item.score > 0)
    .sort((a,b)=> b.score - a.score || b.doc.uploadedAt - a.doc.uploadedAt)
    .map(item => item.doc);
  const target = $('#archiveResults');
  target.innerHTML = '';
  if (!docs.length) return target.innerHTML = `<div class="empty-state">Nenhum documento encontrado.</div>`;
  docs.forEach(doc => target.appendChild(buildDocCard(doc)));
}

function renderSignatureQueue() {
  const pending = getActiveDocs().filter(d => d.signatureStatus === 'pendente_assinatura').sort((a,b)=>b.uploadedAt-a.uploadedAt);
  const target = $('#signatureQueue');
  target.innerHTML = pending.length ? '' : `<div class="empty-state">Nenhum documento pendente de assinatura.</div>`;
  pending.forEach(doc => {
    const div = document.createElement('div');
    div.className = 'item-card';
    div.innerHTML = `<h4>${escapeHtml(doc.fileName)}</h4><p>${escapeHtml(doc.employeeName || 'Não identificado')} · ${escapeHtml(doc.type || 'Outro')}</p><p>${fmtDateTime(doc.uploadedAt)}</p>`;
    div.appendChild(button('Selecionar', 'primary', () => {
      state.selectedSignatureDocId = doc.id;
      $('#selectedSignatureDoc').innerHTML = `<strong>${escapeHtml(doc.fileName)}</strong><br><span class="muted">${escapeHtml(doc.employeeName || 'Não identificado')} · ${escapeHtml(doc.type || 'Outro')}</span>`;
    }));
    target.appendChild(div);
  });
  const selected = getActiveDocs().find(d => d.id === state.selectedSignatureDocId);
  $('#selectedSignatureDoc').innerHTML = selected ? `<strong>${escapeHtml(selected.fileName)}</strong><br><span class="muted">${escapeHtml(selected.employeeName || 'Não identificado')} · ${escapeHtml(selected.type || 'Outro')}</span>` : 'Nenhum documento selecionado.';
}

function groupEmployees() {
  const map = new Map();
  getActiveDocs().forEach(doc => {
    const name = (doc.employeeName || 'Não identificado').trim();
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(doc);
  });
  return [...map.entries()].map(([name, docs]) => ({ name, docs })).sort((a,b)=>a.name.localeCompare(b.name));
}

function renderEmployees() {
  const q = lower($('#employeeSearch').value.trim());
  const list = groupEmployees().filter(e => lower(e.name).includes(q));
  const target = $('#employeeList');
  target.innerHTML = list.length ? '' : `<div class="empty-state">Nenhum colaborador encontrado.</div>`;
  list.forEach(emp => {
    const div = document.createElement('div');
    div.className = 'employee-item';
    div.innerHTML = `<h4>${escapeHtml(emp.name)}</h4><p>${emp.docs.length} documento(s)</p>`;
    div.addEventListener('click', () => renderEmployeeProfile(emp.name));
    target.appendChild(div);
  });
}

function renderEmployeeProfile(name) {
  const docs = getActiveDocs().filter(d => (d.employeeName || 'Não identificado') === name).sort((a,b)=>b.uploadedAt-a.uploadedAt);
  const cpf = docs.find(d => d.cpf)?.cpf || '-';
  const pending = docs.filter(d => d.signatureStatus === 'pendente_assinatura').length;
  const profile = $('#employeeProfile');
  profile.innerHTML = `<div class="profile-head"><div><h3 style="margin:0">${escapeHtml(name)}</h3><p class="muted" style="margin:6px 0 0">CPF: ${escapeHtml(cpf)} · ${docs.length} documento(s)</p></div><span class="chip ${pending ? 'warn' : 'ok'}">${pending ? `${pending} pendente(s)` : 'Tudo em dia'}</span></div><div class="cards-grid" id="employeeDocs"></div>`;
  const wrap = profile.querySelector('#employeeDocs');
  docs.forEach(doc => wrap.appendChild(buildDocCard(doc)));
}

function renderAudit() {
  const target = $('#auditLog');
  const items = [...state.audit].sort((a,b)=>b.timestamp-a.timestamp).slice(0,180);
  target.innerHTML = items.length ? items.map(item => `
    <div class="log-item">
      <h4>${escapeHtml(item.action)}</h4>
      <p>${escapeHtml(item.userName || item.userEmail || '-')} · ${fmtDateTime(item.timestamp)}</p>
      <p>Documento: ${escapeHtml(item.fileName || '-')} ${item.employeeName ? `· Colaborador: ${escapeHtml(item.employeeName)}` : ''}</p>
    </div>`).join('') : `<div class="empty-state">Sem logs ainda.</div>`;
}

function renderTrash() {
  const docs = getTrashDocs().sort((a,b)=>b.deletedAt-a.deletedAt);
  const target = $('#trashList');
  target.innerHTML = '';
  if (!docs.length) return target.innerHTML = `<div class="empty-state">Nenhum documento na lixeira.</div>`;
  docs.forEach(doc => target.appendChild(buildDocCard(doc, { inTrash: true })));
}

function renderAll() {
  renderDashboard();
  renderArchive();
  renderSignatureQueue();
  renderEmployees();
  renderAudit();
  renderTrash();
}

function bindNav() {
  $$('.nav-btn').forEach(btn => btn.addEventListener('click', () => showMainView(btn.dataset.view)));
  $('#refreshBtn').addEventListener('click', () => { renderAll(); notify('Tela atualizada.', 'ok'); });
  $('#globalSearchTop').addEventListener('input', e => {
    $('#archiveSearch').value = e.target.value;
    showMainView('archive');
    renderArchive();
  });
}

function bindFilters() {
  ['#archiveSearch','#archiveTypeFilter','#archiveStatusFilter'].forEach(id => $(id).addEventListener('input', renderArchive));
  $('#employeeSearch').addEventListener('input', renderEmployees);
}

async function saveSignatureForSelected() {
  if (!state.selectedSignatureDocId) return alert('Selecione um documento pendente primeiro.');
  if (signaturePad.isEmpty()) return alert('Desenhe a assinatura antes de salvar.');
  const doc = state.docs.find(d => d.id === state.selectedSignatureDocId);
  if (!doc) return;
  const dataUrl = signaturePad.toDataURL('image/png');
  const blob = await (await fetch(dataUrl)).blob();
  const signRef = storageRef(storage, `assinaturas/${doc.id}.png`);
  await uploadBytes(signRef, blob);
  const signatureUrl = await getDownloadURL(signRef);
  await update(ref(db, `documents/${doc.id}`), {
    signatureStatus: 'assinado', signatureUrl, signedBy: state.user.email, signedAt: Date.now(), updatedAt: Date.now(),
  });
  await logAudit('sign', doc);
  signaturePad.clear();
  state.selectedSignatureDocId = null;
  notify('Documento assinado com sucesso.', 'ok');
}

function openEditModal(doc) {
  if (!isAdmin()) return;
  $('#editDocId').value = doc.id;
  $('#editEmployeeName').value = doc.employeeName || '';
  $('#editCpf').value = doc.cpf || '';
  $('#editType').value = doc.type || 'Outro';
  $('#editDocumentDate').value = doc.documentDate || '';
  $('#editExpiryDate').value = doc.expiryDate || '';
  $('#editSignatureStatus').value = doc.signatureStatus || 'arquivado';
  $('#editNotes').value = doc.notes || '';
  $('#editModal').showModal();
}

async function saveEdit(e) {
  e.preventDefault();
  const id = $('#editDocId').value;
  const doc = state.docs.find(d => d.id === id);
  if (!doc) return;
  const payload = {
    employeeName: normalizeName($('#editEmployeeName').value.trim()) || 'Não identificado',
    cpf: $('#editCpf').value.trim(),
    type: $('#editType').value,
    documentDate: $('#editDocumentDate').value,
    expiryDate: $('#editExpiryDate').value,
    signatureStatus: $('#editSignatureStatus').value,
    notes: $('#editNotes').value.trim(),
    updatedAt: Date.now(),
  };
  await update(ref(db, `documents/${id}`), payload);
  await logAudit('edit', { ...doc, id }, payload);
  $('#editModal').close();
  notify('Metadados atualizados.', 'ok');
}

async function moveToTrash(doc) {
  if (!isAdmin()) return;
  if (!confirm(`Mover "${doc.fileName}" para a lixeira?`)) return;
  await update(ref(db, `documents/${doc.id}`), { deletedAt: Date.now(), deletedBy: state.user.email, updatedAt: Date.now() });
  await logAudit('trash', doc);
}

async function restoreDoc(doc) {
  if (!isAdmin()) return;
  await update(ref(db, `documents/${doc.id}`), { deletedAt: null, deletedBy: '', updatedAt: Date.now() });
  await logAudit('restore', doc);
}

function subscribeData() {
  onValue(ref(db, 'documents'), snap => {
    const items = [];
    snap.forEach(child => items.push({ id: child.key, ...child.val() }));
    state.docs = items;
    renderAll();
  });
  onValue(ref(db, 'auditLogs'), snap => {
    const items = [];
    snap.forEach(child => items.push({ id: child.key, ...child.val() }));
    state.audit = items;
    renderAudit();
  });
}

function friendlyFirebaseError(err) {
  const code = err?.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Login inválido. Verifique e-mail e senha.';
  if (code.includes('email-already-in-use')) return 'Este e-mail já está em uso.';
  if (code.includes('weak-password')) return 'Senha fraca. Use pelo menos 6 caracteres.';
  if (code.includes('network-request-failed')) return 'Falha de rede. Verifique sua internet.';
  if (code.includes('operation-not-allowed')) return 'Ative Email/Password no Firebase Authentication.';
  return err?.message || 'Erro inesperado no Firebase.';
}

function initAuth() {
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, $('#loginEmail').value.trim(), $('#loginPassword').value);
    } catch (err) { alert(friendlyFirebaseError(err)); }
  });

  $('#registerBtn').addEventListener('click', async () => {
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    if (!email || !password) return alert('Preencha e-mail e senha para criar o acesso.');
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const name = normalizeName(email.split('@')[0].replace(/[._-]/g,' '));
      await updateProfile(cred.user, { displayName: name });
      await ensureProfile(cred.user);
      alert('Acesso criado com sucesso.');
    } catch (err) { alert(friendlyFirebaseError(err)); }
  });

  $('#logoutBtn').addEventListener('click', async () => { await signOut(auth); });

  onAuthStateChanged(auth, async user => {
    state.user = user;
    if (user) {
      await ensureProfile(user);
      $('#authView').classList.add('hidden');
      $('#mainViews').classList.remove('hidden');
      $('#userCard').classList.remove('hidden');
      subscribeData();
      showMainView('dashboard');
      await logAudit('login', null);
    } else {
      $('#authView').classList.remove('hidden');
      $('#mainViews').classList.add('hidden');
      $('#userCard').classList.add('hidden');
      state.docs = []; state.audit = []; state.profile = null;
    }
  });
}

function initUpload() {
  $('#docFile').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { await previewAndReadFile(file); }
    catch (err) { console.error(err); notify(`Falha ao ler arquivo: ${err.message}`, 'error'); }
  });
  $('#openCameraBtn').addEventListener('click', () => $('#docFile').click());
  $('#clearUploadBtn').addEventListener('click', clearUploadForm);
  $('#uploadForm').addEventListener('submit', async e => {
    e.preventDefault();
    const file = $('#docFile').files?.[0];
    if (!file) return alert('Selecione um arquivo.');
    try { await uploadDocumentRecord(file); }
    catch (err) { console.error(err); notify(`Erro ao salvar documento: ${err.message}`, 'error'); }
  });
}

function initSignatures() {
  $('#clearSignatureBtn').addEventListener('click', () => signaturePad.clear());
  $('#saveSignatureBtn').addEventListener('click', saveSignatureForSelected);
}

function initEditModal() {
  $('#saveEditBtn').addEventListener('click', saveEdit);
}

bindNav();
bindFilters();
initAuth();
initUpload();
initSignatures();
initEditModal();
notify('Sistema carregado. Faça login para começar.');
