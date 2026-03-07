
DP-INTELIGENTE

Como usar:

1. Abra o arquivo index.html
2. Ative no Firebase:
   - Realtime Database
   - Storage

Realtime Database rules teste:

{
 "rules": {
   ".read": true,
   ".write": true
 }
}

Storage rules teste:

allow read, write: if true;
