const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

// ============================================================
// Helper : format YYYY-MM-DD (local, PAS UTC)
// ============================================================
function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ============================================================
// Helper : renvoie "maintenant" calé sur le fuseau de Zurich
// ============================================================
function getZurichNow() {
  const now = new Date();
  // Convertit l'instant UTC en date "locale" Zurich
  return new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Zurich" })
  );
}

// ============================================================
// Fonction planifiée : tous les jours à 9h heure de Zurich
// Envoie un rappel J-7 pour chaque échéance arrivant dans 7 jours
// ============================================================
exports.dailyReminders = functions.pubsub
  .schedule("every day 09:00")
  .timeZone("Europe/Zurich")
  .onRun(async (context) => {
    const db = admin.firestore();
    const messaging = admin.messaging();

    // --- Calcul des dates en heure de Zurich ---
    const zurichNow = getZurichNow();
    const targetDate = new Date(zurichNow);
    targetDate.setDate(zurichNow.getDate() + 7);

    const targetStr = formatDate(targetDate);
    const todayStr = formatDate(zurichNow);

    console.log("=== dailyReminders démarré ===");
    console.log("Aujourd'hui (Zurich) :", todayStr);
    console.log("Cible (J+7) :", targetStr);

    // --- Récupère tous les utilisateurs ---
    const usersSnap = await db.collection("users").get();
    console.log(`Utilisateurs trouvés : ${usersSnap.size}`);

    let sent = 0;
    let skippedNoToken = 0;
    let skippedNoData = 0;
    let skippedNoDue = 0;
    let errors = 0;

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();

      // --- Vérifie le token FCM ---
      const token = userData.fcmToken;
      if (!token) {
        skippedNoToken++;
        continue;
      }

      // --- Récupère les données de l'app (champ "data") ---
      // Supporte les deux formats :
      //  - string JSON (ancien format)
      //  - objet structuré (nouveau format Firestore)
      let appData;
      try {
        if (typeof userData.data === "string") {
          appData = JSON.parse(userData.data || "{}");
        } else if (typeof userData.data === "object" && userData.data !== null) {
          appData = userData.data;
        } else {
          appData = {};
        }
      } catch (e) {
        console.log(`Erreur parse data pour ${userDoc.id} :`, e.message);
        skippedNoData++;
        continue;
      }

      const documents = appData.documents || [];
      const family = appData.family || [];
      const applications = appData.applications || [];

      // --- Cherche les échéances dans exactement 7 jours ---
      const allItems = [...documents, ...family, ...applications];
      const dueItems = allItems.filter(
        (item) => !item.done && item.due === targetStr
      );

      if (dueItems.length === 0) {
        skippedNoDue++;
        continue;
      }

      // --- Envoie les notifications ---
      for (const item of dueItems) {
        try {
          await messaging.send({
            token: token,
            notification: {
              title: "📅 Rappel Helvetia-Tools",
              body: `${item.text} - échéance dans 7 jours (${targetStr})`,
            },
            webpush: {
              fcmOptions: {
                link: "https://bendel89.github.io/helvetia-tools-v2/",
              },
            },
          });
          sent++;
          console.log(`✅ Notif envoyée à ${userDoc.id} : "${item.text}"`);
        } catch (e) {
          errors++;
          console.log(`❌ Erreur envoi pour ${userDoc.id} :`, e.message);

          // Si le token est invalide/expiré, on le supprime de Firestore
          if (
            e.code === "messaging/invalid-registration-token" ||
            e.code === "messaging/registration-token-not-registered"
          ) {
            try {
              await userDoc.ref.update({
                fcmToken: admin.firestore.FieldValue.delete(),
              });
              console.log(`🗑️ Token invalide supprimé pour ${userDoc.id}`);
            } catch (delErr) {
              console.log(
                `Impossible de supprimer le token de ${userDoc.id} :`,
                delErr.message
              );
            }
          }
        }
      }
    }

    // --- Récap final dans les logs ---
    console.log("=== dailyReminders terminé ===");
    console.log(`📤 Notifications envoyées : ${sent}`);
    console.log(`⏭️ Ignorés (pas de token) : ${skippedNoToken}`);
    console.log(`⏭️ Ignorés (data invalide) : ${skippedNoData}`);
    console.log(`⏭️ Ignorés (pas d'échéance J+7) : ${skippedNoDue}`);
    console.log(`❌ Erreurs d'envoi : ${errors}`);

    return null;
  });