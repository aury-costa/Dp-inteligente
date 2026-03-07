# DP-Inteligente v2

Sistema web em HTML/CSS/JS para o Departamento Pessoal, compatível com **GitHub Pages + Firebase**.

## O que esta versão já entrega

- Login da equipe do DP com **Firebase Authentication**
- Upload de **imagem ou PDF**
- **Scanner direto da câmera** no celular (`capture="environment"`)
- **OCR automático** em imagens com **Tesseract.js**
- Extração de texto de PDF com **PDF.js**
- Detecção automática de:
  - nome do colaborador
  - CPF
  - tipo do documento
  - data do documento
- Busca global tipo Google dentro do texto indexado
- Perfil do colaborador sem criar pasta manual
- Fila de assinatura eletrônica com desenho na tela
- Dashboard com alertas de vencimento
- Log de auditoria de:
  - login
  - upload
  - abertura
  - download
  - assinatura

## Arquivos principais

- `index.html`
- `style.css`
- `firebase-config.js`
- `firebase.js`
- `main.js`

## Publicação no GitHub Pages

Suba todos os arquivos na raiz do repositório `Dp-inteligente`.

## Firebase necessário

### 1) Authentication
Ative:
- Email/Password

### 2) Realtime Database
Crie o banco e use inicialmente regras de teste:

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

### 3) Storage
Use inicialmente uma regra simples autenticada:

```txt
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## Observações importantes

### OCR em PDF
- PDFs com texto digital: a leitura funciona bem com PDF.js.
- PDFs escaneados como imagem podem precisar ser convertidos para imagem no frontend para OCR mais pesado. Esta versão já resolve bem imagens e PDFs com texto.

### Assinatura eletrônica
- A assinatura é desenhada na tela e salva no Firebase Storage.
- O sistema registra o status do documento como `assinado`.

### Busca inteligente
A busca considera:
- nome do colaborador
- CPF
- tipo do documento
- nome do arquivo
- texto extraído pelo OCR
- observações

## Estrutura do banco esperada

### `documents`
Cada documento salvo contém, por exemplo:
- `fileName`
- `fileUrl`
- `employeeName`
- `cpf`
- `type`
- `documentDate`
- `expiryDate`
- `extractedText`
- `requiresSignature`
- `signatureStatus`
- `signatureUrl`
- `uploadedBy`
- `uploadedAt`

### `auditLogs`
Cada log contém:
- `action`
- `docId`
- `fileName`
- `employeeName`
- `userUid`
- `userEmail`
- `userName`
- `timestamp`

## Correção do erro da versão anterior
O erro `Cannot use import statement outside a module` foi corrigido porque agora o carregamento do JS principal está assim:

```html
<script type="module" src="./main.js"></script>
```

E os botões não usam mais `onclick` inline; tudo foi migrado para listeners em JavaScript.

## Próximas melhorias recomendadas

- separação por permissões (admin, analista, somente leitura)
- assinatura do colaborador por link externo
- geração de PDF já assinado visualmente
- tags automáticas mais avançadas
- alerta por e-mail
- dashboard com gráficos
- exclusão lógica e lixeira
