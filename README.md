# DP-Inteligente v3

Sistema web em HTML/CSS/JS para Departamento Pessoal com:

- login da equipe pelo Firebase Authentication
- upload de PDF e imagem
- câmera do celular para captura rápida
- OCR automático com Tesseract
- leitura de PDF com OCR em PDF escaneado
- busca tipo Google no conteúdo indexado
- perfil por colaborador sem criar pasta manual
- fila de assinatura com assinatura desenhada na tela
- dashboard com alertas de vencimento
- auditoria de login, upload, abertura, download, assinatura, edição e lixeira
- lixeira com restauração
- edição de metadados

## Arquivos

- `index.html`
- `style.css`
- `firebase-config.js`
- `firebase.js`
- `main.js`

## Como publicar no GitHub Pages

1. Extraia o ZIP.
2. Suba os arquivos para a raiz do repositório do GitHub Pages.
3. Aguarde a publicação.

## Configuração no Firebase

Ative:

- Authentication > Sign-in method > Email/Password
- Realtime Database
- Storage

## Regras iniciais de teste

### Realtime Database

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

### Storage

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

## Estrutura de dados usada

- `documents`
- `auditLogs`
- `users`

## Observações reais

- O OCR funciona muito melhor com foto nítida e documento bem enquadrado.
- PDF com texto embutido é lido rápido.
- PDF escaneado tenta OCR nas primeiras páginas.
- A assinatura fica salva como imagem vinculada ao documento.
- A marcação visual da assinatura dentro do próprio PDF ainda não está embutindo a assinatura no arquivo original; o sistema salva a assinatura associada ao documento.
