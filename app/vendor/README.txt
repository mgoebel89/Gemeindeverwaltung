Dieser Ordner enthält die PDF-Bibliothek (jsPDF), damit die App vollständig
offline funktioniert.

Datei:
  jspdf.inline.js    jsPDF v2.5.1 (UMD-Bundle), Quelle: https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js

Sollte die Datei einmal fehlen, lässt sie sich in PowerShell aus dem
SitzungsApp-Ordner heraus neu beschaffen:

  Invoke-WebRequest -Uri "https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js" -OutFile "vendor/jspdf.inline.js"

Nach dem Laden steht im Browser window.jspdf.jsPDF zur Verfügung; src/export/pdf.js nutzt das.

Datei:
  marked.min.js    marked v12.0.2 (UMD-Bundle), Quelle: https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js

Nur für die Markdown-Live-Vorschau in der Aufgaben-Detailkarte (src/views/aufgaben.js).
Nach dem Laden steht im Browser window.marked zur Verfügung. Die maßgebliche
Markdown⇄HTML-Konvertierung beim Speichern/Laden läuft im Backend (marked + turndown).

  Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js" -OutFile "vendor/marked.min.js"
