const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions");

admin.initializeApp();

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

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

    console.log("Recherche des échéances pour le :", targetStr);

    const usersSnap = await db.collection("users").get();
    let sent = 0;

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const token = userData.fcmToken;
      if (!token) continue;

      let appData;
      try {
        appData = JSON.parse(userData.data || "{}");
      } catch (e) {
        continue;
      }

      const documents = appData.documents || [];
      const family = appData.family || [];
      const applications = appData.applications || [];

      const allItems = [...documents, ...family, ...applications];
      const dueItems = allItems.filter(
        (item) => !item.done && item.due === targetStr
      );

      if (dueItems.length === 0) continue;

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
        } catch (e) {
          console.log("Erreur envoi :", e.message);
        }
      }
    }

    console.log("Total notifications envoyées :", sent);
    return null;
  });

exports.askClaude = onCall(
  { secrets: [ANTHROPIC_API_KEY], region: "us-central1" },
  async (request) => {
    const prompt = request.data && request.data.prompt;
    if (!prompt) {
      throw new HttpsError("invalid-argument", "Prompt manquant.");
    }

    const apiKey = ANTHROPIC_API_KEY.value();

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error("Erreur Claude", response.status, errText);
      throw new HttpsError("internal", `Claude ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return { text: data.content[0].text };
  }
);
