const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

// Fonction qui tourne tous les jours à 9h
exports.dailyReminders = functions.pubsub
  .schedule("every day 09:00")
  .timeZone("Europe/Zurich")
  .onRun(async (context) => {
    const db = admin.firestore();
    const messaging = admin.messaging();
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + 7);
    const targetStr = targetDate.toISOString().split("T")[0];
    const todayStr = today.toISOString().split("T")[0];

    console.log("Recherche des échéances pour le :", targetStr);

    // Récupère tous les utilisateurs
    const usersSnap = await db.collection("users").get();
    let sent = 0;

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const token = userData.fcmToken;
      if (!token) continue;

      // Récupère les données de l'utilisateur
      let appData;
      try {
        appData = JSON.parse(userData.data || "{}");
      } catch (e) { continue; }

      const documents = appData.documents || [];
      const family = appData.family || [];
      const applications = appData.applications || [];

      // Cherche les échéances dans 7 jours
      const allItems = [...documents, ...family, ...applications];
      const dueItems = allItems.filter(item => 
        !item.done && item.due === targetStr
      );

      if (dueItems.length === 0) continue;

      // Envoie une notification
      for (const item of dueItems) {
        try {
          await messaging.send({
            token: token,
            notification: {
              title: "📅 Rappel Helvetia-Tools",
              body: `${item.text} - échéance dans 7 jours (${targetStr})`
            },
            webpush: {
              fcmOptions: {
                link: "https://bendel89.github.io/helvetia-tools-v2/"
              }
            }
          });
          sent++;
        } catch (e) {
          console.log("Erreur envoi :", e.message);
        }
      }
    }

    console.log("Total notifications envoyées :", sent);
    return null;
  });