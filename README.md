# Lamentometro

Il gioco di coppia per contare le lamentele. Ognuno parte ogni giorno con gli stessi punti; quando l'altro si lamenta gli togli 1 punto (Lamento) o 3 (SuperLamento). A mezzanotte chi ha meno punti fa la penitenza scelta dall'altro.

App web installabile sul telefono (PWA), in italiano, con fuso orario di Roma.

## Regole

- **Account:** email e password, più un nome utente univoco per farsi trovare. Password dimenticata: arriva un PIN di 6 cifre per email, valido 15 minuti.
- **Persone:** cerchi un nome utente e chiedi di seguirlo; l'altro deve accettare. Tutti gli inviti stanno nella sezione Inviti.
- **Gioco:** inviti una persona che segui scegliendo punti al giorno, orario limite (default 11:00) e lista di penitenze. Il gioco parte quando l'altro accetta e dura finché non viene eliminato. Un solo gioco attivo a testa.
- **Mattina:** entro l'orario limite ognuno sceglie la penitenza per l'altro (poi non si cambia). Se ne manca una la giornata salta. Il punteggio del giorno è quello di default; chi lo vuole cambiare lo propone e l'altro deve accettare. Se il gioco nasce dopo l'orario limite, il primo giorno c'è tempo fino alle 23:59.
- **Lamentele:** -1 o -3, senza limiti, titolo e descrizione facoltativi. Il punteggio non scende sotto zero. Chi la segna può annullarla entro 5 minuti.
- **Contestazioni:** chi riceve una lamentela può contestarla una volta (annullarla oppure cambiare titolo e descrizione). Se l'altro rifiuta resta valida; se accetta si salvano versione prima e dopo.
- **Fine giornata:** chi ha meno punti fa la penitenza; con il pareggio nessuno.
- **Eliminazione:** chi elimina il gioco lo chiude anche per l'altro e libera il posto per uno nuovo. Quando l'hanno eliminato entrambi sparisce dal server. Prima si può scaricare il log completo in JSON.
- **Extra:** storico completo, statistiche (vittorie, serie, punti, lamentela più frequente), notifiche push.

## Sviluppo

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # test delle regole di gioco
```

Senza SMTP configurato, le email (PIN) vengono stampate nel log del server.

## Pubblicazione su Coolify

1. In Coolify: **+ New → Application**, scegli questo repository GitHub, branch `main`.
2. **Build Pack:** `Dockerfile`. **Port:** `3000`.
3. **Domains:** `https://lamentometro.miodominio.it` (il record DNS deve puntare al server).
4. **Persistent Storage:** aggiungi un volume con destinazione `/data`. Qui vive il database SQLite: senza volume i dati si perdono a ogni deploy.
5. **Environment Variables:** copia quelle di `.env.example` e compilale:
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` per l'invio dei PIN.
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` per le notifiche. Le chiavi si generano una volta con `npx web-push generate-vapid-keys`.
6. **Deploy.** Ogni push su `main` può ripartire da solo se attivi l'auto deploy.

Backup: basta copiare il file `/data/lamentometro.db` dal volume.

Su iPhone le notifiche funzionano solo dopo aver aggiunto l'app alla schermata Home (Condividi → Aggiungi a Home).
