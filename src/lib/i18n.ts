/** Idiomas de la interfaz. El texto original (clave) está en español; cada entrada trae [en-GB, de, fr, it]. */
import { useSyncExternalStore } from "react";

export type Lang = "es" | "en-GB" | "de" | "fr" | "it";

export const LANGS: { id: Lang; name: string }[] = [
  { id: "es", name: "Español" },
  { id: "en-GB", name: "English (UK)" },
  { id: "de", name: "Deutsch" },
  { id: "fr", name: "Français" },
  { id: "it", name: "Italiano" },
];

const KEY = "caesar.lang";
const ORDER: Lang[] = ["en-GB", "de", "fr", "it"];

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY) as Lang | null;
    if (saved && LANGS.some((l) => l.id === saved)) return saved;
  } catch {
    /* sin almacenamiento */
  }
  const nav = (typeof navigator !== "undefined" ? navigator.language : "es").toLowerCase();
  if (nav.startsWith("es")) return "es";
  if (nav.startsWith("de")) return "de";
  if (nav.startsWith("fr")) return "fr";
  if (nav.startsWith("it")) return "it";
  return "en-GB";
}

let current: Lang = detect();
const listeners = new Set<() => void>();

export function setLang(l: Lang) {
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* sin almacenamiento */
  }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

export const getLang = () => current;

/** Re-renderiza el componente cuando cambia el idioma. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => current,
  );
}

/** Traduce un texto (clave en español). `{0}`, `{1}`… se sustituyen por los argumentos. */
export function t(key: string, ...args: (string | number)[]): string {
  let s = key;
  if (current !== "es") {
    const row = D[key];
    if (row) s = row[ORDER.indexOf(current)] ?? key;
  }
  return args.length ? s.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? "")) : s;
}

type Row = [string, string, string, string];

const D: Record<string, Row> = {
  "{0} elementos": ["{0} items", "{0} Elemente", "{0} éléments", "{0} elementi"],
  "Espacio de equipo": ["Team workspace", "Team-Arbeitsbereich", "Espace d’équipe", "Spazio di team"],
  "Actualizar espacio de equipo": ["Refresh team workspace", "Team-Arbeitsbereich aktualisieren", "Actualiser l’espace d’équipe", "Aggiorna spazio di team"],
  "Unirme a un espacio con un código": ["Join a workspace with a code", "Arbeitsbereich mit Code beitreten", "Rejoindre un espace avec un code", "Unisciti a uno spazio con un codice"],
  "Compartir este espacio con un equipo": ["Share this workspace with a team", "Diesen Arbeitsbereich mit einem Team teilen", "Partager cet espace avec une équipe", "Condividi questo spazio con un team"],
  "Espacio compartido": ["Workspace shared", "Arbeitsbereich geteilt", "Espace partagé", "Spazio condiviso"],
  "Pasa este código a tu equipo. Cada persona lo pega en el selector de espacios → «Unirme a un espacio con un código».": ["Give this code to your team. Everyone pastes it in the workspace selector → “Join a workspace with a code”.", "Gib diesen Code an dein Team weiter. Jeder fügt ihn im Arbeitsbereich-Menü unter „Arbeitsbereich mit Code beitreten“ ein.", "Donne ce code à ton équipe. Chacun le colle dans le sélecteur d’espaces → « Rejoindre un espace avec un code ».", "Passa questo codice al tuo team. Ognuno lo incolla nel selettore degli spazi → «Unisciti a uno spazio con un codice»."],
  "Todo el espacio (sus colecciones) pasará a ser de quienes tengan el código: cualquiera podrá editarlo y los cambios se sincronizan al guardar y al pulsar Actualizar.": ["The whole workspace (its collections) will belong to everyone with the code: anyone can edit it and changes sync when saved and when pressing Refresh.", "Der ganze Arbeitsbereich (seine Sammlungen) gehört dann allen mit dem Code: jeder kann ihn bearbeiten, Änderungen werden beim Speichern und beim Aktualisieren synchronisiert.", "Tout l’espace (ses collections) appartiendra à ceux qui ont le code : chacun peut le modifier et les changements se synchronisent à l’enregistrement et à l’actualisation.", "L’intero spazio (le sue raccolte) sarà di tutti quelli che hanno il codice: chiunque può modificarlo e le modifiche si sincronizzano al salvataggio e all’aggiornamento."],
  "Si quien lo comparte elimina su cuenta, el espacio se elimina de la nube para todos y no se puede recuperar.": ["If the person who shares it deletes their account, the workspace is deleted for everyone and cannot be recovered.", "Löscht die teilende Person ihr Konto, wird der Arbeitsbereich für alle gelöscht und kann nicht wiederhergestellt werden.", "Si la personne qui le partage supprime son compte, l’espace est supprimé pour tous et ne peut pas être récupéré.", "Se chi lo condivide elimina l’account, lo spazio viene eliminato per tutti e non si può recuperare."],
  "Compartir también las variables del espacio": ["Also share the workspace variables", "Auch die Variablen des Arbeitsbereichs teilen", "Partager aussi les variables de l’espace", "Condividi anche le variabili dello spazio"],
  "Pueden contener claves o tokens. Si no lo marcas, cada persona conserva las suyas.": ["They may contain keys or tokens. If unchecked, everyone keeps their own.", "Sie können Schlüssel oder Tokens enthalten. Ohne Haken behält jeder seine eigenen.", "Elles peuvent contenir des clés ou des jetons. Si tu ne coches pas, chacun garde les siennes.", "Possono contenere chiavi o token. Se non lo selezioni, ognuno conserva le proprie."],
  "Entiendo que el espacio pasa a ser de todo el equipo.": ["I understand the workspace becomes the whole team’s.", "Ich verstehe, dass der Arbeitsbereich dem ganzen Team gehört.", "Je comprends que l’espace devient celui de toute l’équipe.", "Capisco che lo spazio diventa di tutto il team."],
  "Ya tienes ese espacio de equipo.": ["You already have that team workspace.", "Diesen Team-Arbeitsbereich hast du schon.", "Tu as déjà cet espace d’équipe.", "Hai già questo spazio di team."],
  "Este espacio ya está compartido: no se pueden añadir colecciones de equipo sueltas dentro de él.": ["This workspace is already shared: loose team collections cannot be added inside it.", "Dieser Arbeitsbereich ist bereits geteilt: Einzelne Teamsammlungen können darin nicht hinzugefügt werden.", "Cet espace est déjà partagé : on ne peut pas y ajouter des collections d’équipe isolées.", "Questo spazio è già condiviso: non si possono aggiungere raccolte di team singole al suo interno."],
  "Este espacio ya está compartido: no se pueden compartir colecciones sueltas dentro de él.": ["This workspace is already shared: loose collections cannot be shared inside it.", "Dieser Arbeitsbereich ist bereits geteilt: Einzelne Sammlungen können darin nicht geteilt werden.", "Cet espace est déjà partagé : on ne peut pas y partager des collections isolées.", "Questo spazio è già condiviso: non si possono condividere raccolte singole al suo interno."],
  "Espacio no encontrado.": ["Workspace not found.", "Arbeitsbereich nicht gefunden.", "Espace introuvable.", "Spazio non trovato."],
  "Este espacio tiene colecciones de equipo: deja de compartirlas antes de compartir el espacio entero.": ["This workspace has team collections: stop sharing them before sharing the whole workspace.", "Dieser Arbeitsbereich enthält Teamsammlungen: Beende zuerst deren Teilen, bevor du den ganzen Arbeitsbereich teilst.", "Cet espace contient des collections d’équipe : arrête de les partager avant de partager tout l’espace.", "Questo spazio contiene raccolte di team: smetti di condividerle prima di condividere l’intero spazio."],
  "El espacio compartido no es válido.": ["The shared workspace is not valid.", "Der geteilte Arbeitsbereich ist ungültig.", "L’espace partagé n’est pas valide.", "Lo spazio condiviso non è valido."],
  "Espacio actualizado.": ["Workspace updated.", "Arbeitsbereich aktualisiert.", "Espace mis à jour.", "Spazio aggiornato."],
  "Personal": ["Personal", "Persönlich", "Personnel", "Personale"],
  "Espacio de trabajo": ["Workspace", "Arbeitsbereich", "Espace de travail", "Spazio di lavoro"],
  "Espacios de trabajo": ["Workspaces", "Arbeitsbereiche", "Espaces de travail", "Spazi di lavoro"],
  "Nuevo espacio de trabajo": ["New workspace", "Neuer Arbeitsbereich", "Nouvel espace de travail", "Nuovo spazio di lavoro"],
  "Renombrar este espacio": ["Rename this workspace", "Diesen Arbeitsbereich umbenennen", "Renommer cet espace", "Rinomina questo spazio"],
  "Eliminar este espacio": ["Delete this workspace", "Diesen Arbeitsbereich löschen", "Supprimer cet espace", "Elimina questo spazio"],
  "Pulsa otra vez: se borra con todo lo que contiene": ["Press again: it is deleted with everything in it", "Erneut drücken: wird samt Inhalt gelöscht", "Appuie encore : il est supprimé avec tout son contenu", "Premi ancora: viene eliminato con tutto il contenuto"],
  "Nombre del espacio": ["Workspace name", "Name des Arbeitsbereichs", "Nom de l’espace", "Nome dello spazio"],
  "Actualizar colección de equipo": ["Refresh team collection", "Teamsammlung aktualisieren", "Actualiser la collection d’équipe", "Aggiorna raccolta di team"],
  "Colección actualizada.": ["Collection updated.", "Sammlung aktualisiert.", "Collection mise à jour.", "Raccolta aggiornata."],
  "Ya tienes la última versión.": ["You already have the latest version.", "Du hast bereits die neueste Version.", "Tu as déjà la dernière version.", "Hai già l’ultima versione."],
  "Registrarse con Google": ["Sign up with Google", "Mit Google registrieren", "S’inscrire avec Google", "Registrati con Google"],
  "Registrarse con GitHub": ["Sign up with GitHub", "Mit GitHub registrieren", "S’inscrire avec GitHub", "Registrati con GitHub"],
  "Sesión iniciada": ["Signed in", "Angemeldet", "Connecté", "Accesso effettuato"],
  "Con problemas de sincronización": ["Sync problems", "Probleme bei der Synchronisierung", "Problèmes de synchronisation", "Problemi di sincronizzazione"],
  "Subiendo cambios…": ["Uploading changes…", "Änderungen werden hochgeladen…", "Envoi des modifications…", "Caricamento modifiche…"],
  "Se cerrará la sesión en este equipo. Antes se sube lo que tengas pendiente.": ["You will be signed out on this computer. Anything pending is uploaded first.", "Du wirst auf diesem Gerät abgemeldet. Ausstehendes wird vorher hochgeladen.", "Tu seras déconnecté sur cet ordinateur. Ce qui est en attente est d’abord envoyé.", "Uscirai da questo computer. Prima viene caricato ciò che è in sospeso."],
  "Se quitan de este equipo": ["Removed from this computer", "Werden von diesem Gerät entfernt", "Retirées de cet ordinateur", "Rimosse da questo computer"],
  "{0} colección(es) compartida(s). Siguen en la nube para su equipo.": ["{0} shared collection(s). They stay in the cloud for your team.", "{0} geteilte Sammlung(en). Sie bleiben für dein Team in der Cloud.", "{0} collection(s) partagée(s). Elles restent dans le cloud pour ton équipe.", "{0} raccolta/e condivisa/e. Restano nel cloud per il tuo team."],
  "no tienes colecciones compartidas.": ["you have no shared collections.", "du hast keine geteilten Sammlungen.", "tu n’as aucune collection partagée.", "non hai raccolte condivise."],
  "Se quedan": ["Kept", "Bleiben erhalten", "Conservés", "Restano"],
  "tus colecciones locales, variables y ajustes.": ["your local collections, variables and settings.", "deine lokalen Sammlungen, Variablen und Einstellungen.", "tes collections locales, variables et réglages.", "le tue raccolte locali, variabili e impostazioni."],
  "Cerrando sesión…": ["Signing out…", "Abmelden…", "Déconnexion…", "Disconnessione…"],
  "Sí, cerrar sesión": ["Yes, sign out", "Ja, abmelden", "Oui, me déconnecter", "Sì, esci"],
  "Escribe tu correo y tu contraseña.": ["Enter your email and password.", "Gib deine E-Mail und dein Passwort ein.", "Saisis ton e-mail et ton mot de passe.", "Inserisci email e password."],
  "Crea una cuenta para sincronizar tus colecciones y compartirlas con tu equipo.": ["Create an account to sync your collections and share them with your team.", "Erstelle ein Konto, um Sammlungen zu synchronisieren und mit deinem Team zu teilen.", "Crée un compte pour synchroniser tes collections et les partager avec ton équipe.", "Crea un account per sincronizzare le raccolte e condividerle con il team."],
  "Inicia sesión para sincronizar y volver a ver tus colecciones compartidas. Sin sesión, Caesar sigue funcionando en local.": ["Sign in to sync and see your shared collections again. Without an account, Caesar keeps working locally.", "Melde dich an, um zu synchronisieren und deine geteilten Sammlungen wieder zu sehen. Ohne Konto arbeitet Caesar lokal weiter.", "Connecte-toi pour synchroniser et retrouver tes collections partagées. Sans compte, Caesar continue de fonctionner en local.", "Accedi per sincronizzare e rivedere le raccolte condivise. Senza account, Caesar continua a funzionare in locale."],
  "Sesión cerrada.": ["Signed out.", "Abgemeldet.", "Déconnecté.", "Disconnesso."],
  "Sesión cerrada. Las colecciones compartidas han salido de este equipo; las locales se quedan.": ["Signed out. Shared collections have left this computer; local ones stay.", "Abgemeldet. Geteilte Sammlungen wurden von diesem Gerät entfernt; lokale bleiben.", "Déconnecté. Les collections partagées ont quitté cet ordinateur ; les locales restent.", "Disconnesso. Le raccolte condivise hanno lasciato questo computer; quelle locali restano."],
  "Sesión cerrada: las colecciones compartidas han salido de este equipo.": ["Signed out: shared collections have left this computer.", "Abgemeldet: Geteilte Sammlungen wurden von diesem Gerät entfernt.", "Déconnecté : les collections partagées ont quitté cet ordinateur.", "Disconnesso: le raccolte condivise hanno lasciato questo computer."],
  "Se borrarán tu cuenta y los datos cifrados de la nube. Las colecciones compartidas saldrán de este equipo; tus colecciones locales no se tocan. Si tienes suscripción, cancélala antes en «Gestionar suscripción».": ["Your account and encrypted cloud data will be deleted. Shared collections will leave this computer; your local collections are untouched. If you have a subscription, cancel it first in “Manage subscription”.", "Dein Konto und die verschlüsselten Cloud-Daten werden gelöscht. Geteilte Sammlungen verlassen dieses Gerät; lokale Sammlungen bleiben unberührt. Kündige ein Abo vorher unter „Abo verwalten“.", "Ton compte et les données chiffrées du cloud seront supprimés. Les collections partagées quitteront cet ordinateur ; tes collections locales ne sont pas touchées. Si tu as un abonnement, annule-le d’abord dans « Gérer l’abonnement ».", "Account e dati cifrati nel cloud saranno eliminati. Le raccolte condivise lasceranno questo computer; quelle locali non vengono toccate. Se hai un abbonamento, annullalo prima in «Gestisci abbonamento»."],
  "o": ["or", "oder", "ou", "oppure"],
  "Entra con otra cuenta: este equipo pasará a usarla.": ["Sign in with another account: this computer will switch to it.", "Mit einem anderen Konto anmelden: Dieses Gerät wechselt darauf.", "Connecte-toi avec un autre compte : cet ordinateur passera dessus.", "Accedi con un altro account: questo computer passerà a usarlo."],
  "Crea otra cuenta: este equipo pasará a usarla.": ["Create another account: this computer will switch to it.", "Ein weiteres Konto erstellen: Dieses Gerät wechselt darauf.", "Crée un autre compte : cet ordinateur passera dessus.", "Crea un altro account: questo computer passerà a usarlo."],
  "+ Más métodos…": ["+ More methods…", "+ Weitere Methoden…", "+ Plus de méthodes…", "+ Altri metodi…"],
  "Métodos HTTP": ["HTTP methods", "HTTP-Methoden", "Méthodes HTTP", "Metodi HTTP"],
  "Elige qué métodos aparecen en el desplegable de la petición. También puedes abrir esta pantalla con «+ Más métodos…» al final de ese desplegable.": ["Choose which methods appear in the request dropdown. You can also open this screen with “+ More methods…” at the end of that dropdown.", "Wähle, welche Methoden im Dropdown der Anfrage erscheinen. Diesen Bildschirm öffnest du auch mit „+ Weitere Methoden…“ am Ende des Dropdowns.", "Choisis les méthodes affichées dans la liste de la requête. Tu peux aussi ouvrir cet écran avec « + Plus de méthodes… » à la fin de la liste.", "Scegli quali metodi compaiono nel menu della richiesta. Puoi aprire questa schermata anche con «+ Altri metodi…» in fondo al menu."],
  "Siempre disponibles": ["Always available", "Immer verfügbar", "Toujours disponibles", "Sempre disponibili"],
  "Otro método (p. ej. REPORT)": ["Other method (e.g. REPORT)", "Andere Methode (z. B. REPORT)", "Autre méthode (p. ex. REPORT)", "Altro metodo (es. REPORT)"],
  "Añadir": ["Add", "Hinzufügen", "Ajouter", "Aggiungi"],
  "Continuar con Google": ["Continue with Google", "Weiter mit Google", "Continuer avec Google", "Continua con Google"],
  "Esperando al navegador…": ["Waiting for the browser…", "Warte auf den Browser…", "En attente du navigateur…", "In attesa del browser…"],
  "Se ha abierto tu navegador: elige tu cuenta de Google y vuelve aquí.": ["Your browser has opened: choose your Google account and come back here.", "Dein Browser wurde geöffnet: Wähle dein Google-Konto und komm hierher zurück.", "Ton navigateur s’est ouvert : choisis ton compte Google et reviens ici.", "Il browser si è aperto: scegli il tuo account Google e torna qui."],
  "Versión de HTTP": ["HTTP version", "HTTP-Version", "Version HTTP", "Versione HTTP"],
  "Automática": ["Auto", "Automatisch", "Automatique", "Automatica"],
  "Edición y atajos": ["Editing & shortcuts", "Bearbeiten & Tastenkürzel", "Édition et raccourcis", "Modifica e scorciatoie"],
  "Autoguardado": ["Autosave", "Automatisch speichern", "Enregistrement auto", "Salvataggio automatico"],
  "Guarda solo en la colección las peticiones que ya están en ella, un instante después de dejar de editar. Los borradores nuevos se siguen guardando con Ctrl+S.": ["Saves requests that already belong to a collection a moment after you stop editing. New drafts are still saved with Ctrl+S.", "Speichert Anfragen, die schon in einer Sammlung sind, kurz nach dem Bearbeiten. Neue Entwürfe werden weiterhin mit Strg+S gespeichert.", "Enregistre les requêtes déjà dans une collection peu après la fin de la modification. Les nouveaux brouillons s’enregistrent toujours avec Ctrl+S.", "Salva le richieste già in una raccolta poco dopo aver smesso di modificare. Le nuove bozze si salvano ancora con Ctrl+S."],
  "Atajos de teclado": ["Keyboard shortcuts", "Tastenkürzel", "Raccourcis clavier", "Scorciatoie da tastiera"],
  "Guardar la petición en la colección": ["Save the request to the collection", "Anfrage in der Sammlung speichern", "Enregistrer la requête dans la collection", "Salva la richiesta nella raccolta"],
  "Enviar la petición": ["Send the request", "Anfrage senden", "Envoyer la requête", "Invia la richiesta"],
  "Cerrar la pestaña": ["Close the tab", "Tab schließen", "Fermer l’onglet", "Chiudi la scheda"],
  "Pestaña siguiente / anterior": ["Next / previous tab", "Nächster / vorheriger Tab", "Onglet suivant / précédent", "Scheda successiva / precedente"],
  "Ir a la pestaña número N": ["Go to tab number N", "Zu Tab Nummer N", "Aller à l’onglet numéro N", "Vai alla scheda numero N"],
  "Volver / avanzar en las pestañas visitadas": ["Back / forward through visited tabs", "Zurück / vor durch besuchte Tabs", "Reculer / avancer dans les onglets visités", "Indietro / avanti tra le schede visitate"],
  "Ir a la barra de URL": ["Go to the URL bar", "Zur URL-Leiste", "Aller à la barre d’URL", "Vai alla barra URL"],
  "Buscar en la respuesta o en el editor": ["Search in the response or editor", "In Antwort oder Editor suchen", "Rechercher dans la réponse ou l’éditeur", "Cerca nella risposta o nell’editor"],
  "Elegir una variable de entorno": ["Pick an environment variable", "Umgebungsvariable wählen", "Choisir une variable d’environnement", "Scegli una variabile d’ambiente"],
  "Abrir los ajustes": ["Open settings", "Einstellungen öffnen", "Ouvrir les réglages", "Apri le impostazioni"],
  "Ver estos atajos": ["Show these shortcuts", "Diese Kürzel anzeigen", "Voir ces raccourcis", "Mostra queste scorciatoie"],
  "En macOS, Ctrl se sustituye por Cmd.": ["On macOS, Ctrl is replaced by Cmd.", "Auf macOS wird Strg durch Cmd ersetzt.", "Sur macOS, Ctrl est remplacé par Cmd.", "Su macOS, Ctrl è sostituito da Cmd."],
  "Mostrar mi clave de recuperación": ["Show my recovery key", "Meinen Wiederherstellungsschlüssel anzeigen", "Afficher ma clé de récupération", "Mostra la mia chiave di recupero"],
  "Crear clave nueva": ["Create new key", "Neuen Schlüssel erstellen", "Créer une nouvelle clé", "Crea nuova chiave"],
  "Usar otra clave de recuperación": ["Use another recovery key", "Anderen Wiederherstellungsschlüssel verwenden", "Utiliser une autre clé de récupération", "Usa un’altra chiave di recupero"],
  "Se crea una clave nueva y se vuelven a subir tus datos cifrados con ella. Los demás equipos que usen la clave anterior dejarán de sincronizar hasta que les pongas la nueva (Usar otra clave de recuperación). Tu clave anterior se conserva en este equipo para leer datos antiguos.": ["A new key is created and your data is uploaded again encrypted with it. Other computers using the old key will stop syncing until you give them the new one (Use another recovery key). Your old key is kept on this computer to read old data.", "Es wird ein neuer Schlüssel erstellt und deine Daten werden damit verschlüsselt neu hochgeladen. Andere Geräte mit dem alten Schlüssel synchronisieren nicht mehr, bis du ihnen den neuen gibst (Anderen Wiederherstellungsschlüssel verwenden). Der alte Schlüssel bleibt auf diesem Gerät, um alte Daten zu lesen.", "Une nouvelle clé est créée et tes données sont renvoyées chiffrées avec elle. Les autres ordinateurs avec l’ancienne clé cessent de se synchroniser jusqu’à ce que tu leur donnes la nouvelle (Utiliser une autre clé de récupération). Ton ancienne clé reste sur cet ordinateur pour lire les anciennes données.", "Viene creata una nuova chiave e i dati vengono ricaricati cifrati con essa. Gli altri computer con la chiave vecchia smettono di sincronizzare finché non dai loro la nuova (Usa un’altra chiave di recupero). La vecchia chiave resta su questo computer per leggere i dati vecchi."],
  "Sí, crear clave nueva": ["Yes, create new key", "Ja, neuen Schlüssel erstellen", "Oui, créer une nouvelle clé", "Sì, crea nuova chiave"],
  "Pega la clave de recuperación del otro equipo. Este equipo pasará a usarla y volverá a sincronizar con ella.": ["Paste the recovery key from the other computer. This computer will switch to it and sync with it.", "Füge den Wiederherstellungsschlüssel des anderen Geräts ein. Dieses Gerät wechselt darauf und synchronisiert damit.", "Colle la clé de récupération de l’autre ordinateur. Celui-ci l’utilisera et se synchronisera avec elle.", "Incolla la chiave di recupero dell’altro computer. Questo computer la userà e sincronizzerà con essa."],
  "Usar esta clave": ["Use this key", "Diesen Schlüssel verwenden", "Utiliser cette clé", "Usa questa chiave"],
  "Guárdala en un gestor de contraseñas: sin ella no podrás recuperar tus datos en otro equipo. Puedes volver a verla con «Mostrar mi clave de recuperación».": ["Save it in a password manager: without it you cannot recover your data on another computer. You can see it again with “Show my recovery key”.", "Speichere ihn in einem Passwortmanager: ohne ihn kannst du deine Daten auf einem anderen Gerät nicht wiederherstellen. Du kannst ihn mit „Meinen Wiederherstellungsschlüssel anzeigen“ erneut sehen.", "Garde-la dans un gestionnaire de mots de passe : sans elle, tu ne pourras pas récupérer tes données sur un autre ordinateur. Tu peux la revoir avec « Afficher ma clé de récupération ».", "Salvala in un gestore di password: senza non potrai recuperare i dati su un altro computer. Puoi rivederla con «Mostra la mia chiave di recupero»."],
  "Copiar": ["Copy", "Kopieren", "Copier", "Copia"],
  "Copiada": ["Copied", "Kopiert", "Copiée", "Copiata"],
  "Hay una versión nueva": ["There is a new version", "Es gibt eine neue Version", "Une nouvelle version est disponible", "C’è una nuova versione"],
  "Novedades": ["What’s new", "Neuigkeiten", "Nouveautés", "Novità"],
  "Mejoras y correcciones.": ["Improvements and fixes.", "Verbesserungen und Fehlerbehebungen.", "Améliorations et corrections.", "Miglioramenti e correzioni."],
  "Más tarde": ["Later", "Später", "Plus tard", "Più tardi"],
  "Actualizar ahora": ["Update now", "Jetzt aktualisieren", "Mettre à jour", "Aggiorna ora"],
  // ── Equipos y canal de desarrollo ──
  "Colección de equipo": ["Team collection", "Teamsammlung", "Collection d’équipe", "Raccolta di team"],
  "Equipo: código y opciones": ["Team: code and options", "Team: Code und Optionen", "Équipe : code et options", "Team: codice e opzioni"],
  "Compartir con un equipo": ["Share with a team", "Mit einem Team teilen", "Partager avec une équipe", "Condividi con un team"],
  "Ya tienes esa colección de equipo.": ["You already have that team collection.", "Diese Teamsammlung hast du schon.", "Tu as déjà cette collection d’équipe.", "Hai già questa raccolta di team."],
  "La colección del equipo no es válida.": ["The team collection is not valid.", "Die Teamsammlung ist ungültig.", "La collection d’équipe n’est pas valide.", "La raccolta di team non è valida."],
  "Colección no encontrada.": ["Collection not found.", "Sammlung nicht gefunden.", "Collection introuvable.", "Raccolta non trovata."],
  "No se guardó la copia de seguridad.": ["The backup was not saved.", "Das Backup wurde nicht gespeichert.", "La sauvegarde n’a pas été enregistrée.", "Il backup non è stato salvato."],
  "«{0}» ya no se comparte (su dueño la eliminó). Conservas tu copia local.": ["“{0}” is no longer shared (its owner removed it). You keep your local copy.", "„{0}“ wird nicht mehr geteilt (der Besitzer hat sie entfernt). Du behältst deine lokale Kopie.", "« {0} » n’est plus partagée (son propriétaire l’a supprimée). Tu gardes ta copie locale.", "«{0}» non è più condivisa (il proprietario l’ha eliminata). Conservi la copia locale."],
  "Crear colección propia": ["Create my own collection", "Eigene Sammlung erstellen", "Créer ma propre collection", "Crea una raccolta personale"],
  "O unirte a una de equipo": ["Or join a team one", "Oder einer Teamsammlung beitreten", "Ou rejoindre une collection d’équipe", "Oppure unisciti a una di team"],
  "Uniéndote…": ["Joining…", "Beitritt…", "Connexion…", "Unione…"],
  "Unirme": ["Join", "Beitreten", "Rejoindre", "Unisciti"],
  "Necesitas haber iniciado sesión (Ajustes → Sincronización). La colección se descarga a tu equipo y se mantiene al día sola.": ["You need to be signed in (Settings → Sync). The collection is downloaded to your computer and kept up to date automatically.", "Du musst angemeldet sein (Einstellungen → Synchronisierung). Die Sammlung wird heruntergeladen und automatisch aktuell gehalten.", "Tu dois être connecté (Réglages → Synchronisation). La collection est téléchargée et se met à jour toute seule.", "Devi aver effettuato l’accesso (Impostazioni → Sincronizzazione). La raccolta viene scaricata e resta aggiornata da sola."],
  "Colección compartida": ["Collection shared", "Sammlung geteilt", "Collection partagée", "Raccolta condivisa"],
  "Pasa este código a tu equipo. Cada persona lo pega en «Nueva colección → Unirme».": ["Give this code to your team. Everyone pastes it in “New collection → Join”.", "Gib diesen Code an dein Team weiter. Jeder fügt ihn unter „Neue Sammlung → Beitreten“ ein.", "Donne ce code à ton équipe. Chacun le colle dans « Nouvelle collection → Rejoindre ».", "Passa questo codice al tuo team. Ognuno lo incolla in «Nuova raccolta → Unisciti»."],
  "Compartir «{0}» con el equipo": ["Share “{0}” with the team", "„{0}“ mit dem Team teilen", "Partager « {0} » avec l’équipe", "Condividi «{0}» con il team"],
  "La colección pasará a ser de todos los que tengan el código: cualquiera podrá editarla y los cambios se sincronizan solos.": ["The collection will belong to everyone with the code: anyone can edit it and changes sync automatically.", "Die Sammlung gehört dann allen mit dem Code: jeder kann sie bearbeiten, Änderungen werden automatisch synchronisiert.", "La collection appartiendra à tous ceux qui ont le code : chacun peut la modifier et les changements se synchronisent seuls.", "La raccolta sarà di tutti quelli che hanno il codice: chiunque può modificarla e le modifiche si sincronizzano da sole."],
  "Si quien la comparte elimina su cuenta, la colección se elimina para todos y no se puede recuperar.": ["If the person who shares it deletes their account, the collection is deleted for everyone and cannot be recovered.", "Löscht die teilende Person ihr Konto, wird die Sammlung für alle gelöscht und kann nicht wiederhergestellt werden.", "Si la personne qui la partage supprime son compte, la collection est supprimée pour tous et ne peut pas être récupérée.", "Se chi la condivide elimina l’account, la raccolta viene eliminata per tutti e non si può recuperare."],
  "Antes de continuar, guarda una copia de seguridad en el formato que prefieras:": ["Before continuing, save a backup in the format you prefer:", "Speichere vor dem Fortfahren ein Backup im gewünschten Format:", "Avant de continuer, enregistre une sauvegarde au format de ton choix :", "Prima di continuare, salva un backup nel formato che preferisci:"],
  "Entiendo que la colección pasa a ser de todo el equipo.": ["I understand the collection becomes the whole team’s.", "Ich verstehe, dass die Sammlung dem ganzen Team gehört.", "Je comprends que la collection devient celle de toute l’équipe.", "Capisco che la raccolta diventa di tutto il team."],
  "Compartiendo…": ["Sharing…", "Teile…", "Partage…", "Condivisione…"],
  "Compartir": ["Share", "Teilen", "Partager", "Condividi"],
  "Equipo: {0}": ["Team: {0}", "Team: {0}", "Équipe : {0}", "Team: {0}"],
  "Código para invitar a más personas:": ["Code to invite more people:", "Code, um weitere Personen einzuladen:", "Code pour inviter d’autres personnes :", "Codice per invitare altre persone:"],
  "Eres quien la compartió: si dejas de compartir o eliminas tu cuenta, se elimina de la nube para todos (cada persona conserva su copia local).": ["You shared it: if you stop sharing or delete your account it is removed from the cloud for everyone (each person keeps their local copy).", "Du hast sie geteilt: Wenn du das Teilen beendest oder dein Konto löschst, wird sie für alle aus der Cloud entfernt (jeder behält seine lokale Kopie).", "C’est toi qui l’as partagée : si tu arrêtes de la partager ou supprimes ton compte, elle est supprimée du cloud pour tous (chacun garde sa copie locale).", "L’hai condivisa tu: se smetti di condividerla o elimini l’account, viene rimossa dal cloud per tutti (ognuno conserva la copia locale)."],
  "Si sales del equipo, conservas tu copia local pero ya no se sincroniza.": ["If you leave the team you keep your local copy but it no longer syncs.", "Wenn du das Team verlässt, behältst du deine lokale Kopie, sie wird aber nicht mehr synchronisiert.", "Si tu quittes l’équipe, tu gardes ta copie locale mais elle ne se synchronise plus.", "Se esci dal team conservi la copia locale ma non si sincronizza più."],
  "Pulsa otra vez para confirmar": ["Press again to confirm", "Zum Bestätigen erneut drücken", "Appuie encore pour confirmer", "Premi ancora per confermare"],
  "Dejar de compartir": ["Stop sharing", "Teilen beenden", "Arrêter de partager", "Smetti di condividere"],
  "Salir del equipo": ["Leave team", "Team verlassen", "Quitter l’équipe", "Esci dal team"],
  "Copiar código": ["Copy code", "Code kopieren", "Copier le code", "Copia codice"],
  "Personalización de interfaz": ["Interface customisation", "Oberfläche anpassen", "Personnalisation de l’interface", "Personalizzazione interfaccia"],
  "Todo lo visual de la aplicación en un solo sitio: tema, fuente, tamaños de letra y cómo se ve la respuesta. Los cambios se aplican al instante.": ["Everything visual in one place: theme, font, font sizes and how the response looks. Changes apply instantly.", "Alles Visuelle an einem Ort: Design, Schriftart, Schriftgrößen und Darstellung der Antwort. Änderungen gelten sofort.", "Tout l’aspect visuel au même endroit : thème, police, tailles et affichage de la réponse. Les changements s’appliquent aussitôt.", "Tutto l’aspetto in un posto solo: tema, carattere, dimensioni e come appare la risposta. Le modifiche sono immediate."],
  // ── Bienvenida ──
  "Volver": ["Back", "Zurück", "Retour", "Indietro"],
  "Crear cuenta": ["Create account", "Konto erstellen", "Créer un compte", "Crea account"],
  "Iniciar sesión": ["Sign in", "Anmelden", "Se connecter", "Accedi"],
  "Contraseña": ["Password", "Passwort", "Mot de passe", "Password"],
  "Un momento…": ["One moment…", "Einen Moment…", "Un instant…", "Un momento…"],
  "Ya tengo cuenta": ["I already have an account", "Ich habe schon ein Konto", "J'ai déjà un compte", "Ho già un account"],
  "Crear una cuenta": ["Create an account", "Konto erstellen", "Créer un compte", "Crea un account"],
  "Bienvenido. Elige cómo quieres empezar.": ["Welcome. Choose how you want to start.", "Willkommen. Wähle, wie du starten möchtest.", "Bienvenue. Choisissez comment commencer.", "Benvenuto. Scegli come iniziare."],
  "Registrarse": ["Sign up", "Registrieren", "S'inscrire", "Registrati"],
  "Continuar como invitado": ["Continue as guest", "Als Gast fortfahren", "Continuer en tant qu'invité", "Continua come ospite"],
  "Como invitado, tus datos se guardan solo en este dispositivo. Si lo borras o cambias de equipo, los perderás.": ["As a guest, your data is stored only on this device. If you wipe it or switch computers, you will lose it.", "Als Gast werden deine Daten nur auf diesem Gerät gespeichert. Wenn du es löschst oder den Computer wechselst, gehen sie verloren.", "En tant qu'invité, vos données sont stockées uniquement sur cet appareil. Si vous l'effacez ou changez d'ordinateur, vous les perdrez.", "Come ospite, i tuoi dati restano solo su questo dispositivo. Se lo cancelli o cambi computer, li perderai."],
  "Al continuar aceptas nuestros": ["By continuing you accept our", "Indem du fortfährst, akzeptierst du unsere", "En continuant, vous acceptez nos", "Continuando accetti i nostri"],
  "y reconoces nuestra": ["and acknowledge our", "und bestätigst unsere", "et reconnaissez notre", "e riconosci la nostra"],
  "Términos": ["Terms", "Nutzungsbedingungen", "Conditions d'utilisation", "Termini"],
  "Política de privacidad": ["Privacy Policy", "Datenschutzerklärung", "Politique de confidentialité", "Informativa sulla privacy"],
  "Correo": ["Email", "E-Mail", "E-mail", "Email"],
  "Esa cuenta ya existe": ["That account already exists", "Dieses Konto existiert bereits", "Ce compte existe déjà", "Questo account esiste già"],
  "Puedes continuar: se vincularán las cuentas y, a partir de ahora, podrás iniciar sesión con las dos.": ["You can continue: the accounts will be linked and from now on you can sign in with both.", "Du kannst fortfahren: Die Konten werden verknüpft und du kannst dich künftig mit beiden anmelden.", "Vous pouvez continuer : les comptes seront liés et vous pourrez désormais vous connecter avec les deux.", "Puoi continuare: gli account verranno collegati e da ora potrai accedere con entrambi."],
  "Contraseña de esa cuenta": ["Password for that account", "Passwort dieses Kontos", "Mot de passe de ce compte", "Password di quell'account"],
  "Vincular y continuar": ["Link and continue", "Verknüpfen und fortfahren", "Lier et continuer", "Collega e continua"],
  "Para vincular, inicia sesión primero con": ["To link, first sign in with", "Zum Verknüpfen melde dich zuerst an mit", "Pour lier, connectez-vous d'abord avec", "Per collegare, accedi prima con"],
  "Continuar con GitHub": ["Continue with GitHub", "Mit GitHub fortfahren", "Continuer avec GitHub", "Continua con GitHub"],
  "Escribe este código en GitHub (se ha abierto la página) y autoriza Caesar:": ["Enter this code on GitHub (the page has opened) and authorise Caesar:", "Gib diesen Code auf GitHub ein (die Seite wurde geöffnet) und autorisiere Caesar:", "Saisissez ce code sur GitHub (la page s'est ouverte) et autorisez Caesar :", "Inserisci questo codice su GitHub (la pagina si è aperta) e autorizza Caesar:"],
  // ── Auth, fuentes, variables y filtro ──
  "Tipo de letra": ["Typeface", "Schriftart", "Police", "Carattere"],
  "Elige la fuente de la interfaz. Todas se incluyen en la app y funcionan sin conexión. Los editores de código siguen en monoespaciada.": ["Choose the interface font. All of them ship with the app and work offline. Code editors stay monospaced.", "Wähle die Schriftart der Oberfläche. Alle sind in der App enthalten und funktionieren offline. Code-Editoren bleiben monospaced.", "Choisis la police de l’interface. Toutes sont incluses dans l’app et fonctionnent hors ligne. Les éditeurs de code restent en monospace.", "Scegli il carattere dell’interfaccia. Sono tutti inclusi nell’app e funzionano offline. Gli editor di codice restano a spaziatura fissa."],
  "Caesar (predeterminada)": ["Caesar (default)", "Caesar (Standard)", "Caesar (par défaut)", "Caesar (predefinito)"],
  "Ocultar": ["Hide", "Verbergen", "Masquer", "Nascondi"],
  "Mostrar": ["Show", "Anzeigen", "Afficher", "Mostra"],
  "Usa la autorización de la colección: {0}.": ["Uses the collection’s authorization: {0}.", "Verwendet die Autorisierung der Sammlung: {0}.", "Utilise l’autorisation de la collection : {0}.", "Usa l’autorizzazione della raccolta: {0}."],
  "La colección no define autorización: la petición se envía sin ella. Puedes configurarla en la barra lateral, en «Autorización de la colección».": ["The collection defines no authorization: the request is sent without it. You can set it in the sidebar, under “Collection authorization”.", "Die Sammlung definiert keine Autorisierung: die Anfrage wird ohne sie gesendet. Du kannst sie in der Seitenleiste unter „Autorisierung der Sammlung“ festlegen.", "La collection ne définit aucune autorisation : la requête est envoyée sans elle. Tu peux la configurer dans la barre latérale, sous « Autorisation de la collection ».", "La raccolta non definisce autorizzazione: la richiesta viene inviata senza. Puoi impostarla nella barra laterale, in «Autorizzazione della raccolta»."],
  "Se pide primero la página sin credenciales y, con el desafío del servidor, se vuelve a enviar firmada.": ["The request is first sent without credentials and, using the server’s challenge, sent again signed.", "Die Anfrage wird zuerst ohne Zugangsdaten gesendet und dann mit der Server-Challenge signiert erneut gesendet.", "La requête est d’abord envoyée sans identifiants puis, avec le défi du serveur, renvoyée signée.", "La richiesta viene prima inviata senza credenziali e, con la sfida del server, reinviata firmata."],
  "NTLMv2. Autentica la conexión: Caesar hace el intercambio de 3 pasos por la misma conexión.": ["NTLMv2. It authenticates the connection: Caesar does the 3-step exchange over the same connection.", "NTLMv2. Authentifiziert die Verbindung: Caesar führt den 3-Schritte-Austausch über dieselbe Verbindung aus.", "NTLMv2. Authentifie la connexion : Caesar fait l’échange en 3 étapes sur la même connexion.", "NTLMv2. Autentica la connessione: Caesar esegue lo scambio in 3 passaggi sulla stessa connessione."],
  "Si dejas Service y Region vacíos se deducen del host (servicio.región.amazonaws.com). Los cuerpos form-data se firman como UNSIGNED-PAYLOAD.": ["If Service and Region are empty they are inferred from the host (service.region.amazonaws.com). form-data bodies are signed as UNSIGNED-PAYLOAD.", "Sind Service und Region leer, werden sie aus dem Host abgeleitet (service.region.amazonaws.com). form-data-Bodys werden als UNSIGNED-PAYLOAD signiert.", "Si Service et Region sont vides, ils sont déduits de l’hôte (service.region.amazonaws.com). Les corps form-data sont signés en UNSIGNED-PAYLOAD.", "Se Service e Region sono vuoti vengono dedotti dall’host (servizio.regione.amazonaws.com). I body form-data sono firmati come UNSIGNED-PAYLOAD."],
  "Token manual": ["Manual token", "Manuelles Token", "Jeton manuel", "Token manuale"],
  "Credenciales de cliente": ["Client credentials", "Client-Zugangsdaten", "Identifiants du client", "Credenziali del client"],
  "En el cuerpo": ["In the body", "Im Body", "Dans le corps", "Nel body"],
  "Cabecera Basic Auth": ["Basic Auth header", "Basic-Auth-Header", "En-tête Basic Auth", "Header Basic Auth"],
  "El token se pide al enviar y se reutiliza hasta que caduque.": ["The token is requested when sending and reused until it expires.", "Das Token wird beim Senden angefordert und bis zum Ablauf wiederverwendet.", "Le jeton est demandé à l’envoi et réutilisé jusqu’à son expiration.", "Il token viene richiesto all’invio e riutilizzato fino alla scadenza."],
  "Añadir token a": ["Add token to", "Token hinzufügen zu", "Ajouter le jeton à", "Aggiungi token a"],
  "Autorización de la colección": ["Collection authorization", "Autorisierung der Sammlung", "Autorisation de la collection", "Autorizzazione della raccolta"],
  "Abre una petición de una colección para editar su autorización.": ["Open a request from a collection to edit its authorization.", "Öffne eine Anfrage einer Sammlung, um ihre Autorisierung zu bearbeiten.", "Ouvre une requête d’une collection pour modifier son autorisation.", "Apri una richiesta di una raccolta per modificarne l’autorizzazione."],
  "Buscar variable…": ["Search variable…", "Variable suchen…", "Chercher une variable…", "Cerca variabile…"],
  "Ninguna variable coincide.": ["No variable matches.", "Keine Variable passt.", "Aucune variable ne correspond.", "Nessuna variabile corrisponde."],
  "No hay variables definidas. Créalas en la barra lateral.": ["No variables defined. Create them in the sidebar.", "Keine Variablen definiert. Lege sie in der Seitenleiste an.", "Aucune variable définie. Crée-les dans la barre latérale.", "Nessuna variabile definita. Creale nella barra laterale."],
  "↑↓ elegir · Enter insertar · Esc cerrar": ["↑↓ choose · Enter insert · Esc close", "↑↓ wählen · Enter einfügen · Esc schließen", "↑↓ choisir · Entrée insérer · Échap fermer", "↑↓ scegli · Invio inserisci · Esc chiudi"],
  "Filtrar: $[*].campo (JSONPath) · o una expresión regular": ["Filter: $[*].field (JSONPath) · or a regular expression", "Filter: $[*].feld (JSONPath) · oder regulärer Ausdruck", "Filtre : $[*].champ (JSONPath) · ou expression régulière", "Filtro: $[*].campo (JSONPath) · o espressione regolare"],
  "1 resultado": ["1 result", "1 Ergebnis", "1 résultat", "1 risultato"],
  "{0} resultados": ["{0} results", "{0} Ergebnisse", "{0} résultats", "{0} risultati"],
  "Quitar filtro (Esc)": ["Clear filter (Esc)", "Filter entfernen (Esc)", "Retirer le filtre (Échap)", "Rimuovi filtro (Esc)"],
  "No se puede formatear: el body usa variables {{x}} fuera de comillas.": ["Cannot format: the body uses {{x}} variables outside quotes.", "Formatieren nicht möglich: der Body verwendet {{x}}-Variablen außerhalb von Anführungszeichen.", "Mise en forme impossible : le corps utilise des variables {{x}} hors des guillemets.", "Impossibile formattare: il body usa variabili {{x}} fuori dalle virgolette."],
  "No se puede formatear: el texto usa variables {{x}} fuera de comillas.": ["Cannot format: the text uses {{x}} variables outside quotes.", "Formatieren nicht möglich: der Text verwendet {{x}}-Variablen außerhalb von Anführungszeichen.", "Mise en forme impossible : le texte utilise des variables {{x}} hors des guillemets.", "Impossibile formattare: il testo usa variabili {{x}} fuori dalle virgolette."],
  // ── Barra lateral ──
  "Arrastra para cambiar el ancho · doble clic para restaurar": ["Drag to resize · double-click to reset", "Ziehen zum Ändern der Breite · Doppelklick zum Zurücksetzen", "Glisser pour redimensionner · double-clic pour rétablir", "Trascina per ridimensionare · doppio clic per ripristinare"],
  "Importar": ["Import", "Importieren", "Importer", "Importa"],
  "Importando…": ["Importing…", "Importiere…", "Importation…", "Importazione…"],
  "Exportar": ["Export", "Exportieren", "Exporter", "Esporta"],
  "Exportar una colección (JSON, YAML o HAR)": ["Export a collection (JSON, YAML or HAR)", "Eine Sammlung exportieren (JSON, YAML oder HAR)", "Exporter une collection (JSON, YAML ou HAR)", "Esporta una raccolta (JSON, YAML o HAR)"],
  "No hay colecciones que exportar": ["No collections to export", "Keine Sammlungen zum Exportieren", "Aucune collection à exporter", "Nessuna raccolta da esportare"],
  "Exportar colección": ["Export collection", "Sammlung exportieren", "Exporter la collection", "Esporta raccolta"],
  "Exportar colección (JSON)": ["Export collection (JSON)", "Sammlung exportieren (JSON)", "Exporter la collection (JSON)", "Esporta raccolta (JSON)"],
  "Nueva colección": ["New collection", "Neue Sammlung", "Nouvelle collection", "Nuova raccolta"],
  "Mi colección": ["My collection", "Meine Sammlung", "Ma collection", "La mia raccolta"],
  "Crea una colección, importa una (JSON, YAML o HAR) o pega un cURL en la barra de URL.": ["Create a collection, import one (JSON, YAML or HAR) or paste a cURL into the URL bar.", "Erstelle eine Sammlung, importiere eine (JSON, YAML oder HAR) oder füge ein cURL in die URL-Leiste ein.", "Crée une collection, importe-en une (JSON, YAML ou HAR) ou colle un cURL dans la barre d’URL.", "Crea una raccolta, importane una (JSON, YAML o HAR) o incolla un cURL nella barra URL."],
  "Ajustes": ["Settings", "Einstellungen", "Paramètres", "Impostazioni"],
  "Variables de colección": ["Collection variables", "Sammlungsvariablen", "Variables de collection", "Variabili della raccolta"],
  "Variables globales": ["Global variables", "Globale Variablen", "Variables globales", "Variabili globali"],
  "Abre una petición de una colección para editar sus variables.": ["Open a request from a collection to edit its variables.", "Öffne eine Anfrage einer Sammlung, um deren Variablen zu bearbeiten.", "Ouvrez une requête d'une collection pour modifier ses variables.", "Apri una richiesta di una raccolta per modificarne le variabili."],
  "Pulsa otra vez para borrar": ["Click again to delete", "Erneut klicken zum Löschen", "Cliquez à nouveau pour supprimer", "Clicca di nuovo per eliminare"],
  "Eliminar": ["Delete", "Löschen", "Supprimer", "Elimina"],
  "Nueva petición": ["New request", "Neue Anfrage", "Nouvelle requête", "Nuova richiesta"],
  "Nueva carpeta": ["New folder", "Neuer Ordner", "Nouveau dossier", "Nuova cartella"],
  "Renombrar": ["Rename", "Umbenennen", "Renommer", "Rinomina"],
  "Vacío": ["Empty", "Leer", "Vide", "Vuoto"],

  // ── Pestañas y barra de petición ──
  "Cambios sin guardar": ["Unsaved changes", "Nicht gespeicherte Änderungen", "Modifications non enregistrées", "Modifiche non salvate"],
  "Cerrar pestaña": ["Close tab", "Tab schließen", "Fermer l'onglet", "Chiudi scheda"],
  "Nueva pestaña": ["New tab", "Neuer Tab", "Nouvel onglet", "Nuova scheda"],
  "Escribe una URL o pega un comando cURL": ["Enter a URL or paste a cURL command", "URL eingeben oder cURL-Befehl einfügen", "Saisissez une URL ou collez une commande cURL", "Scrivi un URL o incolla un comando cURL"],
  "Copiar como cURL": ["Copy as cURL", "Als cURL kopieren", "Copier en cURL", "Copia come cURL"],
  "Guardar en la colección (Ctrl+S)": ["Save to collection (Ctrl+S)", "In Sammlung speichern (Strg+S)", "Enregistrer dans la collection (Ctrl+S)", "Salva nella raccolta (Ctrl+S)"],
  "Copiado": ["Copied", "Kopiert", "Copié", "Copiato"],
  "Guardado": ["Saved", "Gespeichert", "Enregistré", "Salvato"],
  "Guardar": ["Save", "Speichern", "Enregistrer", "Salva"],
  "Enviando…": ["Sending…", "Sende…", "Envoi…", "Invio…"],
  "Enviar": ["Send", "Senden", "Envoyer", "Invia"],
  "¿Cerrar sin guardar?": ["Close without saving?", "Ohne Speichern schließen?", "Fermer sans enregistrer ?", "Chiudere senza salvare?"],
  "Esta pestaña tiene cambios sin guardar. Si la cierras, se perderán.": ["This tab has unsaved changes. If you close it, they will be lost.", "Dieser Tab hat nicht gespeicherte Änderungen. Beim Schließen gehen sie verloren.", "Cet onglet contient des modifications non enregistrées. Si vous le fermez, elles seront perdues.", "Questa scheda ha modifiche non salvate. Se la chiudi, andranno perse."],
  "Cancelar": ["Cancel", "Abbrechen", "Annuler", "Annulla"],
  "Cerrar sin guardar": ["Close without saving", "Ohne Speichern schließen", "Fermer sans enregistrer", "Chiudi senza salvare"],
  "Guardar y cerrar": ["Save and close", "Speichern und schließen", "Enregistrer et fermer", "Salva e chiudi"],
  "Cerrar (Esc)": ["Close (Esc)", "Schließen (Esc)", "Fermer (Échap)", "Chiudi (Esc)"],
  "Colección exportada: {0}": ["Collection exported: {0}", "Sammlung exportiert: {0}", "Collection exportée : {0}", "Raccolta esportata: {0}"],
  "No se pudo copiar al portapapeles.": ["Could not copy to the clipboard.", "Kopieren in die Zwischenablage fehlgeschlagen.", "Impossible de copier dans le presse-papiers.", "Impossibile copiare negli appunti."],
  "Error desconocido": ["Unknown error", "Unbekannter Fehler", "Erreur inconnue", "Errore sconosciuto"],
  "Validando petición": ["Validating request", "Anfrage wird geprüft", "Validation de la requête", "Convalida della richiesta"],
  "Resolviendo DNS": ["Resolving DNS", "DNS wird aufgelöst", "Résolution DNS", "Risoluzione DNS"],
  "Conectando y esperando respuesta": ["Connecting and waiting for response", "Verbinde und warte auf Antwort", "Connexion et attente de la réponse", "Connessione e attesa della risposta"],
  "Descargando respuesta": ["Downloading response", "Antwort wird heruntergeladen", "Téléchargement de la réponse", "Download della risposta"],
  "Procesando respuesta": ["Processing response", "Antwort wird verarbeitet", "Traitement de la réponse", "Elaborazione della risposta"],
  "Pensando…": ["Thinking…", "Denke nach…", "Réflexion…", "Elaboro…"],

  // ── Editores ──
  "Añadir fila": ["Add row", "Zeile hinzufügen", "Ajouter une ligne", "Aggiungi riga"],
  "Seleccionar archivo": ["Select file", "Datei auswählen", "Sélectionner un fichier", "Seleziona file"],
  "Seleccionar archivo…": ["Select file…", "Datei auswählen…", "Sélectionner un fichier…", "Seleziona file…"],
  "Value (clic para editar)": ["Value (click to edit)", "Value (Klick zum Bearbeiten)", "Value (cliquer pour modifier)", "Value (clic per modificare)"],
  "Content-Type de esta parte": ["Content-Type of this part", "Content-Type dieses Teils", "Content-Type de cette partie", "Content-Type di questa parte"],
  "Content-Type: auto": ["Content-Type: auto", "Content-Type: automatisch", "Content-Type : auto", "Content-Type: auto"],
  "Listo": ["Done", "Fertig", "Terminé", "Fatto"],
  "Formatear con indentación": ["Format with indentation", "Mit Einrückung formatieren", "Formater avec indentation", "Formatta con rientro"],
  "Compactar en una línea": ["Compact into one line", "In eine Zeile komprimieren", "Compacter sur une ligne", "Comprimi su una riga"],
  "Esta petición no envía body.": ["This request sends no body.", "Diese Anfrage sendet keinen Body.", "Cette requête n'envoie pas de body.", "Questa richiesta non invia body."],
  "Texto plano": ["Plain text", "Klartext", "Texte brut", "Testo semplice"],
  "JSON inválido: {0}": ["Invalid JSON: {0}", "Ungültiges JSON: {0}", "JSON invalide : {0}", "JSON non valido: {0}"],
  "error de sintaxis": ["syntax error", "Syntaxfehler", "erreur de syntaxe", "errore di sintassi"],
  "Tipo": ["Type", "Typ", "Type", "Tipo"],
  "Esta petición no usa autorización.": ["This request uses no authorization.", "Diese Anfrage verwendet keine Autorisierung.", "Cette requête n'utilise pas d'autorisation.", "Questa richiesta non usa autorizzazione."],
  "Añadir a": ["Add to", "Hinzufügen zu", "Ajouter à", "Aggiungi a"],
  "Buscar…": ["Search…", "Suchen…", "Rechercher…", "Cerca…"],
  "Anterior (Mayús+Enter)": ["Previous (Shift+Enter)", "Zurück (Umschalt+Enter)", "Précédent (Maj+Entrée)", "Precedente (Maiusc+Invio)"],
  "Siguiente (Enter)": ["Next (Enter)", "Weiter (Enter)", "Suivant (Entrée)", "Successivo (Invio)"],
  "Abrir en el navegador": ["Open in browser", "Im Browser öffnen", "Ouvrir dans le navigateur", "Apri nel browser"],
  "Copiar solo el valor": ["Copy value only", "Nur den Wert kopieren", "Copier uniquement la valeur", "Copia solo il valore"],
  "Buscar (Ctrl+F)": ["Search (Ctrl+F)", "Suchen (Strg+F)", "Rechercher (Ctrl+F)", "Cerca (Ctrl+F)"],

  // ── Pestañas de la petición ──
  "Se ejecuta tras recibir la respuesta:": ["Runs after the response is received:", "Wird nach Erhalt der Antwort ausgeführt:", "S’exécute après réception de la réponse :", "Viene eseguito dopo aver ricevuto la risposta:"],
  "Las variables se guardan en el panel Variables y se usan como": ["Variables are stored in the Variables panel and used as", "Variablen werden im Variablen-Bereich gespeichert und so verwendet:", "Les variables sont enregistrées dans le panneau Variables et s'utilisent ainsi :", "Le variabili vengono salvate nel pannello Variabili e si usano come"],
  "{{nombre}}": ["{{name}}", "{{name}}", "{{nom}}", "{{nome}}"],
  "Insertar ejemplo: guardar el access_token en una variable": ["Insert example: save the access_token in a variable", "Beispiel einfügen: access_token in einer Variable speichern", "Insérer un exemple : enregistrer l'access_token dans une variable", "Inserisci esempio: salva l'access_token in una variabile"],
  "Seguir redirecciones (máx. 10)": ["Follow redirects (max. 10)", "Weiterleitungen folgen (max. 10)", "Suivre les redirections (max. 10)", "Segui i reindirizzamenti (max. 10)"],
  "Verificar certificado SSL": ["Verify SSL certificate", "SSL-Zertifikat prüfen", "Vérifier le certificat SSL", "Verifica il certificato SSL"],
  "⚠ desactivado: solo para pruebas": ["⚠ disabled: for testing only", "⚠ deaktiviert: nur zum Testen", "⚠ désactivé : uniquement pour les tests", "⚠ disattivato: solo per prove"],
  "Timeout (segundos, 0 = 1 hora, máx. 3600)": ["Timeout (seconds, 0 = 1 hour, max 3600)", "Timeout (Sekunden, 0 = 1 Stunde, max. 3600)", "Délai d'attente (secondes, 0 = 1 heure, max 3600)", "Timeout (secondi, 0 = 1 ora, max 3600)"],

  // ── Panel de respuesta ──
  "Arrastra para redimensionar · doble clic para maximizar": ["Drag to resize · double-click to maximise", "Ziehen zum Ändern der Größe · Doppelklick zum Maximieren", "Glisser pour redimensionner · double-clic pour agrandir", "Trascina per ridimensionare · doppio clic per massimizzare"],
  "Restaurar": ["Restore", "Wiederherstellen", "Restaurer", "Ripristina"],
  "Maximizar panel": ["Maximise panel", "Bereich maximieren", "Agrandir le panneau", "Massimizza pannello"],
  "Copy": ["Copy", "Kopieren", "Copier", "Copia"],
  "Truncada (10 MB)": ["Truncated (10 MB)", "Gekürzt (10 MB)", "Tronquée (10 Mo)", "Troncata (10 MB)"],
  "La petición falló": ["The request failed", "Die Anfrage ist fehlgeschlagen", "La requête a échoué", "La richiesta non è riuscita"],
  "Pulsa Send para ver la respuesta.": ["Press Send to see the response.", "Drücke Senden, um die Antwort zu sehen.", "Cliquez sur Envoyer pour voir la réponse.", "Premi Invia per vedere la risposta."],
  "Resultados": ["Results", "Ergebnisse", "Résultats", "Risultati"],
  "Variables actualizadas": ["Updated variables", "Aktualisierte Variablen", "Variables mises à jour", "Variabili aggiornate"],
  "eliminada": ["removed", "entfernt", "supprimée", "rimossa"],
  "Avisos del script": ["Script warnings", "Skript-Warnungen", "Avertissements du script", "Avvisi dello script"],
  "El script se ejecutó sin resultados.": ["The script ran with no results.", "Das Skript wurde ohne Ergebnisse ausgeführt.", "Le script s'est exécuté sans résultat.", "Lo script è stato eseguito senza risultati."],

  // ── Ajustes ──
  "Tema": ["Theme", "Design", "Thème", "Tema"],
  "Tamaño de letra": ["Font size", "Schriftgröße", "Taille de police", "Dimensione carattere"],
  "Respuesta": ["Response", "Antwort", "Réponse", "Risposta"],
  "Actualizaciones": ["Updates", "Updates", "Mises à jour", "Aggiornamenti"],
  "Gato": ["Animation", "Animation", "Animation", "Animazione"],
  "Animación": ["Animation", "Animation", "Animation", "Animazione"],
  "Animaciones: el gatito del logo y la red de nodos de la pantalla de carga. Desactivarlas ahorra memoria y CPU.": ["Animations: the logo kitten and the node network on the loading screen. Turning them off saves memory and CPU.", "Animationen: das Logo-Kätzchen und das Knotennetz auf dem Ladebildschirm. Ausschalten spart Speicher und CPU.", "Animations : le chaton du logo et le réseau de nœuds de l'écran de chargement. Les désactiver économise mémoire et CPU.", "Animazioni: il gattino del logo e la rete di nodi della schermata di caricamento. Disattivarle risparmia memoria e CPU."],
  "Animar la red de nodos": ["Animate the node network", "Knotennetz animieren", "Animer le réseau de nœuds", "Anima la rete di nodi"],
  "Al enviar una petición aparece una red de nodos con pulsos y polvo de estrellas que sigue al ratón, con el color del método. Desactivada, solo se ve el cuadro de pasos.": ["Sending a request shows a node network with pulses and star dust that follows the mouse, in the method's colour. When off, only the steps card is shown.", "Beim Senden einer Anfrage erscheint ein Knotennetz mit Impulsen und Sternenstaub, der der Maus folgt, in der Farbe der Methode. Ausgeschaltet wird nur die Schritte-Karte gezeigt.", "À l'envoi d'une requête apparaît un réseau de nœuds avec des impulsions et une poussière d'étoiles qui suit la souris, à la couleur de la méthode. Désactivé, seule la carte des étapes s'affiche.", "Inviando una richiesta compare una rete di nodi con impulsi e polvere di stelle che segue il mouse, nel colore del metodo. Disattivata, si vede solo la scheda dei passaggi."],
  "El gatito del logo reacciona cuando le haces clic. Desactivarlo lo deja quieto y ahorra algo de memoria y CPU.": ["The logo kitten reacts when you click it. Turning it off keeps it still and saves a little memory and CPU.", "Das Logo-Kätzchen reagiert auf Klicks. Wenn du es ausschaltest, bleibt es still und spart etwas Speicher und CPU.", "Le chaton du logo réagit quand vous cliquez dessus. Le désactiver le laisse immobile et économise un peu de mémoire et de CPU.", "Il gattino del logo reagisce quando lo clicchi. Disattivarlo lo lascia fermo e risparmia un po' di memoria e CPU."],
  "Animar al gatito": ["Animate the kitten", "Kätzchen animieren", "Animer le chaton", "Anima il gattino"],
  "Se menea al pasar el ratón, cierra los ojos de felicidad y suelta corazones al hacerle clic, y salta en la pantalla de actualización.": ["It wiggles on hover, closes its eyes happily and sends out hearts when clicked, and bounces on the update screen.", "Es wackelt beim Darüberfahren, schließt glücklich die Augen und lässt beim Klicken Herzen aufsteigen; auf dem Update-Bildschirm hüpft es.", "Il se trémousse au survol, ferme les yeux de bonheur et lâche des cœurs quand on clique, et saute sur l'écran de mise à jour.", "Si dimena al passaggio del mouse, chiude gli occhi felice e lancia cuoricini al clic, e salta nella schermata di aggiornamento."],
  "Idioma": ["Language", "Sprache", "Langue", "Lingua"],
  "Elige el estilo de la aplicación. Los colores de GET, POST, PUT, PATCH y DELETE son siempre los mismos.": ["Choose the look of the app. The colours of GET, POST, PUT, PATCH and DELETE are always the same.", "Wähle das Aussehen der App. Die Farben von GET, POST, PUT, PATCH und DELETE bleiben immer gleich.", "Choisissez le style de l'application. Les couleurs de GET, POST, PUT, PATCH et DELETE restent toujours les mêmes.", "Scegli lo stile dell'app. I colori di GET, POST, PUT, PATCH e DELETE restano sempre gli stessi."],
  "Ajusta el tamaño de la letra en toda la aplicación o solo en la zona que quieras. Los cambios se aplican al instante.": ["Adjust the font size across the whole app or only in the area you want. Changes apply instantly.", "Passe die Schriftgröße in der ganzen App oder nur in einem Bereich an. Änderungen gelten sofort.", "Réglez la taille de police dans toute l'application ou seulement dans la zone souhaitée. Les changements s'appliquent immédiatement.", "Regola la dimensione del carattere in tutta l'app o solo nella zona che vuoi. Le modifiche si applicano subito."],
  "Cómo se muestra el body de la respuesta que recibes.": ["How the body of the response you receive is displayed.", "Wie der Body der empfangenen Antwort angezeigt wird.", "Comment s'affiche le body de la réponse reçue.", "Come viene mostrato il body della risposta ricevuta."],
  "Las versiones nuevas llegan firmadas desde GitHub; Caesar comprueba la firma antes de instalarlas.": ["New versions arrive signed from GitHub; Caesar checks the signature before installing them.", "Neue Versionen kommen signiert von GitHub; Caesar prüft die Signatur vor der Installation.", "Les nouvelles versions arrivent signées depuis GitHub ; Caesar vérifie la signature avant de les installer.", "Le nuove versioni arrivano firmate da GitHub; Caesar verifica la firma prima di installarle."],
  "Elige el idioma de la interfaz. Se aplica al instante.": ["Choose the interface language. It applies instantly.", "Wähle die Sprache der Oberfläche. Sie gilt sofort.", "Choisissez la langue de l'interface. Elle s'applique immédiatement.", "Scegli la lingua dell'interfaccia. Si applica subito."],
  "General": ["General", "Allgemein", "Général", "Generale"],
  "Toda la aplicación": ["The whole app", "Die ganze App", "Toute l'application", "Tutta l'app"],
  "Barra lateral": ["Sidebar", "Seitenleiste", "Barre latérale", "Barra laterale"],
  "Colecciones, carpetas y variables": ["Collections, folders and variables", "Sammlungen, Ordner und Variablen", "Collections, dossiers et variables", "Raccolte, cartelle e variabili"],
  "Petición": ["Request", "Anfrage", "Requête", "Richiesta"],
  "Pestañas, URL, Params, Headers y Auth": ["Tabs, URL, Params, Headers and Auth", "Tabs, URL, Params, Headers und Auth", "Onglets, URL, Params, Headers et Auth", "Schede, URL, Params, Headers e Auth"],
  "Body que envías": ["Body you send", "Gesendeter Body", "Body envoyé", "Body inviato"],
  "Editor JSON/Text, Edit data y Scripts": ["JSON/Text editor, Edit data and Scripts", "JSON/Text-Editor, Edit data und Scripts", "Éditeur JSON/Text, Edit data et Scripts", "Editor JSON/Text, Edit data e Scripts"],
  "Respuesta recibida": ["Response received", "Empfangene Antwort", "Réponse reçue", "Risposta ricevuta"],
  "Cuerpo de la respuesta (JSON)": ["Response body (JSON)", "Antwort-Body (JSON)", "Corps de la réponse (JSON)", "Corpo della risposta (JSON)"],
  "Restablecer": ["Reset", "Zurücksetzen", "Rétablir", "Ripristina"],
  "Vista previa": ["Preview", "Vorschau", "Aperçu", "Anteprima"],
  "lo que envías": ["what you send", "was du sendest", "ce que vous envoyez", "ciò che invii"],
  "lo que recibes": ["what you receive", "was du empfängst", "ce que vous recevez", "ciò che ricevi"],
  "Restablecer todos los tamaños": ["Reset all sizes", "Alle Größen zurücksetzen", "Rétablir toutes les tailles", "Ripristina tutte le dimensioni"],
  "Ocultar valores vacíos en el body de la respuesta": ["Hide empty values in the response body", "Leere Werte im Antwort-Body ausblenden", "Masquer les valeurs vides dans le body de la réponse", "Nascondi i valori vuoti nel body della risposta"],
  "No muestra los campos que valen null, las listas vacías [] ni los objetos vacíos {} (tampoco los bloques que se quedan sin nada).": ["Does not show fields that are null, empty lists [] or empty objects {} (nor blocks left with nothing inside).", "Blendet Felder mit null, leere Listen [] und leere Objekte {} aus (auch Blöcke, die dadurch leer werden).", "N'affiche pas les champs valant null, les listes vides [] ni les objets vides {} (ni les blocs qui se retrouvent vides).", "Non mostra i campi null, le liste vuote [] né gli oggetti vuoti {} (né i blocchi che restano vuoti)."],
  "Solo cambia lo que ves en la vista Pretty: la vista Raw y el botón Copy siguen usando la respuesta completa.": ["It only changes what you see in the Pretty view: the Raw view and the Copy button still use the full response.", "Es ändert nur die Pretty-Ansicht: Die Raw-Ansicht und die Schaltfläche Copy verwenden weiterhin die vollständige Antwort.", "Cela ne change que la vue Pretty : la vue Raw et le bouton Copy utilisent toujours la réponse complète.", "Cambia solo la vista Pretty: la vista Raw e il pulsante Copy continuano a usare la risposta completa."],
  "Ejemplo": ["Example", "Beispiel", "Exemple", "Esempio"],
  "Versión instalada": ["Installed version", "Installierte Version", "Version installée", "Versione installata"],
  "Actualizar automáticamente": ["Update automatically", "Automatisch aktualisieren", "Mettre à jour automatiquement", "Aggiorna automaticamente"],
  "Al abrir Caesar se busca una versión nueva; si la hay, se descarga, se instala y la app se reinicia sola. Si lo desactivas, Caesar no consulta nada por su cuenta y solo se actualiza cuando pulses el botón.": ["When Caesar opens it looks for a new version; if there is one, it is downloaded, installed and the app restarts by itself. If you turn this off, Caesar checks nothing on its own and only updates when you press the button.", "Beim Start sucht Caesar nach einer neuen Version; falls vorhanden, wird sie heruntergeladen, installiert und die App startet von selbst neu. Wenn du das ausschaltest, prüft Caesar nichts von allein und aktualisiert nur, wenn du die Schaltfläche drückst.", "À l'ouverture, Caesar cherche une nouvelle version ; s'il y en a une, elle est téléchargée, installée et l'application redémarre seule. Si vous désactivez cette option, Caesar ne vérifie rien de lui-même et ne se met à jour que lorsque vous cliquez sur le bouton.", "All'apertura Caesar cerca una nuova versione; se c'è, la scarica, la installa e l'app si riavvia da sola. Se la disattivi, Caesar non controlla nulla da solo e si aggiorna solo quando premi il pulsante."],
  "Buscar actualizaciones": ["Check for updates", "Nach Updates suchen", "Rechercher des mises à jour", "Cerca aggiornamenti"],
  "Instalar v{0}": ["Install v{0}", "v{0} installieren", "Installer la v{0}", "Installa v{0}"],
  "Buscando…": ["Checking…", "Suche…", "Recherche…", "Ricerca…"],
  "Tienes la última versión.": ["You have the latest version.", "Du hast die neueste Version.", "Vous avez la dernière version.", "Hai l'ultima versione."],
  "Hay una versión nueva:": ["There is a new version:", "Es gibt eine neue Version:", "Une nouvelle version est disponible :", "C'è una nuova versione:"],

  // ── Pantalla de actualización ──
  "Actualizando a la v{0}": ["Updating to v{0}", "Aktualisiere auf v{0}", "Mise à jour vers la v{0}", "Aggiornamento alla v{0}"],
  "Descargando…": ["Downloading…", "Lade herunter…", "Téléchargement…", "Download…"],
  "Caesar se reiniciará solo. Tus pestañas y borradores se conservan.": ["Caesar will restart by itself. Your tabs and drafts are kept.", "Caesar startet von selbst neu. Deine Tabs und Entwürfe bleiben erhalten.", "Caesar redémarrera tout seul. Vos onglets et brouillons sont conservés.", "Caesar si riavvierà da solo. Schede e bozze vengono conservate."],
};
