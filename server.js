const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

const PORT = process.env.PORT || 10000;

// --------------------------------------------------
// CORS
// --------------------------------------------------

app.use(cors({
  origin: [
    "https://manuubett.github.io"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// --------------------------------------------------
// FIREBASE ADMIN
// --------------------------------------------------

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// --------------------------------------------------
// VALIDATION
// --------------------------------------------------

const VALID_CHOICES = new Set(["one", "two"]);

const KENYA_COUNTIES = new Set([
  "Mombasa",
  "Kwale",
  "Kilifi",
  "Tana River",
  "Lamu",
  "Taita-Taveta",
  "Garissa",
  "Wajir",
  "Mandera",
  "Marsabit",
  "Isiolo",
  "Meru",
  "Tharaka-Nithi",
  "Embu",
  "Kitui",
  "Machakos",
  "Makueni",
  "Nyandarua",
  "Nyeri",
  "Kirinyaga",
  "Murang'a",
  "Kiambu",
  "Turkana",
  "West Pokot",
  "Samburu",
  "Trans Nzoia",
  "Uasin Gishu",
  "Elgeyo-Marakwet",
  "Nandi",
  "Baringo",
  "Laikipia",
  "Nakuru",
  "Narok",
  "Kajiado",
  "Kericho",
  "Bomet",
  "Kakamega",
  "Vihiga",
  "Bungoma",
  "Busia",
  "Siaya",
  "Kisumu",
  "Homa Bay",
  "Migori",
  "Kisii",
  "Nyamira",
  "Nairobi",
  "Prefer not to say"
]);

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Political Poll API"
  });
});

// --------------------------------------------------
// CAST VOTE
// --------------------------------------------------

app.post("/castVote", async (req, res) => {
  try {

    // Firebase anonymous UID will be sent by frontend
    const uid = req.body.uid;

    const {
      choice,
      county,
      fingerprint
    } = req.body;

    if (!uid || typeof uid !== "string") {
      return res.status(401).json({
        error: "Authentication required."
      });
    }

    if (!VALID_CHOICES.has(choice)) {
      return res.status(400).json({
        error: "choice must be 'one' or 'two'."
      });
    }

    if (
      typeof county !== "string" ||
      !KENYA_COUNTIES.has(county)
    ) {
      return res.status(400).json({
        error: "county is missing or not recognized."
      });
    }

    if (
      typeof fingerprint !== "string" ||
      fingerprint.length < 8 ||
      fingerprint.length > 128
    ) {
      return res.status(400).json({
        error: "fingerprint is missing or malformed."
      });
    }

    const voteRef = db.collection("votes").doc(uid);
    const fpRef = db.collection("fingerprintIndex").doc(fingerprint);

    await db.runTransaction(async (tx) => {

      const [voteSnap, fpSnap] = await Promise.all([
        tx.get(voteRef),
        tx.get(fpRef)
      ]);

      const existingUids =
        fpSnap.exists
          ? fpSnap.data().uids || []
          : [];

      const uids = existingUids.includes(uid)
        ? existingUids
        : [...existingUids, uid];

      tx.set(voteRef, {
        choice,
        county,
        fingerprint,

        updatedAt:
          admin.firestore.FieldValue.serverTimestamp(),

        createdAt:
          voteSnap.exists
            ? voteSnap.data().createdAt
            : admin.firestore.FieldValue.serverTimestamp()
      });

      tx.set(
        fpRef,
        {
          uids,
          lastSeen:
            admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      if (uids.length > 1) {

        const flagRef =
          db.collection("flags").doc(fingerprint);

        tx.set(
          flagRef,
          {
            fingerprint,
            uids,
            voteCount: uids.length,
            flaggedAt:
              admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      }
    });

    return res.json({
      ok: true
    });

  } catch (error) {

    console.error("castVote error:", error);

    return res.status(500).json({
      error: "Could not save vote."
    });
  }
});

// --------------------------------------------------
// CLEAR VOTE
// --------------------------------------------------

app.post("/clearVote", async (req, res) => {

  try {

    const uid = req.body.uid;

    if (!uid || typeof uid !== "string") {
      return res.status(401).json({
        error: "Authentication required."
      });
    }

    await db
      .collection("votes")
      .doc(uid)
      .delete();

    return res.json({
      ok: true
    });

  } catch (error) {

    console.error("clearVote error:", error);

    return res.status(500).json({
      error: "Could not clear vote."
    });
  }
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Poll API running on port ${PORT}`);
});
