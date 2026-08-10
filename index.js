const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// Adjust region if your Firestore/App Check setup lives elsewhere.
setGlobalOptions({ region: "us-central1" });

const VALID_CHOICES = new Set(["one", "two"]);

const KENYA_COUNTIES = new Set([
  "Mombasa","Kwale","Kilifi","Tana River","Lamu","Taita-Taveta","Garissa","Wajir","Mandera",
  "Marsabit","Isiolo","Meru","Tharaka-Nithi","Embu","Kitui","Machakos","Makueni","Nyandarua",
  "Nyeri","Kirinyaga","Murang'a","Kiambu","Turkana","West Pokot","Samburu","Trans Nzoia",
  "Uasin Gishu","Elgeyo-Marakwet","Nandi","Baringo","Laikipia","Nakuru","Narok","Kajiado",
  "Kericho","Bomet","Kakamega","Vihiga","Bungoma","Busia","Siaya","Kisumu","Homa Bay","Migori",
  "Kisii","Nyamira","Nairobi","Prefer not to say"
]);

/**
 * Records / updates the caller's vote and keeps a fingerprint index so
 * that many anonymous UIDs sharing one device fingerprint can be flagged
 * for review. Voting itself is never blocked by the fingerprint check —
 * only surfaced in the `flags` collection, matching the UI's copy.
 */
exports.castVote = onCall(
  { enforceAppCheck: false }, // flip to true once App Check is fully configured
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign-in required.");
    }

    const { choice, county, fingerprint } = request.data || {};

    if (!VALID_CHOICES.has(choice)) {
      throw new HttpsError("invalid-argument", "choice must be 'one' or 'two'.");
    }
    if (typeof county !== "string" || !KENYA_COUNTIES.has(county)) {
      throw new HttpsError("invalid-argument", "county is missing or not recognized.");
    }
    if (typeof fingerprint !== "string" || fingerprint.length < 8 || fingerprint.length > 128) {
      throw new HttpsError("invalid-argument", "fingerprint is missing or malformed.");
    }

    const voteRef = db.collection("votes").doc(uid);
    const fpRef = db.collection("fingerprintIndex").doc(fingerprint);

    await db.runTransaction(async (tx) => {
      const [voteSnap, fpSnap] = await Promise.all([tx.get(voteRef), tx.get(fpRef)]);

      // Write / overwrite this user's single vote document.
      tx.set(voteRef, {
        choice,
        county,
        fingerprint,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: voteSnap.exists
          ? voteSnap.data().createdAt
          : admin.firestore.FieldValue.serverTimestamp(),
      });

      // Track which UIDs have voted under this fingerprint.
      const existingUids = fpSnap.exists ? fpSnap.data().uids || [] : [];
      const uids = existingUids.includes(uid) ? existingUids : [...existingUids, uid];

      tx.set(
        fpRef,
        { uids, lastSeen: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );

      // More than one distinct UID sharing a fingerprint -> flag for review.
      // This does NOT remove or discount anyone's vote; it's informational.
      if (uids.length > 1) {
        const flagRef = db.collection("flags").doc(fingerprint);
        tx.set(
          flagRef,
          {
            fingerprint,
            uids,
            voteCount: uids.length,
            flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    });

    return { ok: true };
  }
);

/**
 * Deletes the caller's vote document. Leaves the fingerprint index alone
 * (so a flagged fingerprint stays visible for review even if one of the
 * associated votes is later withdrawn).
 */
exports.clearVote = onCall(
  { enforceAppCheck: false },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign-in required.");
    }
    await db.collection("votes").doc(uid).delete();
    return { ok: true };
  }
);
