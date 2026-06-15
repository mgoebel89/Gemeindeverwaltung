Dieser Ordner enthält die PDF-Bibliothek (jsPDF), damit die App vollständig
offline funktioniert.

Datei:
  jspdf.inline.js    jsPDF v2.5.1 (UMD-Bundle), Quelle: https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js

Sollte die Datei einmal fehlen, lässt sie sich in PowerShell aus dem
SitzungsApp-Ordner heraus neu beschaffen:

  Invoke-WebRequest -Uri "https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js" -OutFile "vendor/jspdf.inline.js"

Nach dem Laden steht im Browser window.jspdf.jsPDF zur Verfügung; src/export/pdf.js nutzt das.
