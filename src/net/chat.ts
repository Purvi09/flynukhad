// A text channel per city. Append-only; nothing said can be edited afterwards.

import { addDoc, collection, limit, onSnapshot, orderBy, query, serverTimestamp, where } from "firebase/firestore";
import { currentUid, db, firebaseReady } from "./firebase";

export type ChatLine = { id: string; city: string; uid: string; name: string; text: string; at: number };

const CONTACT = /(\+?\d[\d\s\-()]{7,}\d)|([\w.+-]+@[\w-]+\.[\w.]{2,})|(https?:\/\/\S+)|(@[A-Za-z0-9_]{4,})/;

export const chatProblem = (text: string): string | null => {
  const t = text.trim();
  if (t.length < 1) return "Say something first.";
  if (t.length > 240) return "Keep it under 240 characters.";
  if (CONTACT.test(t)) return "No phone numbers, emails, links or handles in the city chat.";
  return null;
};

export const chatAvailable = () => firebaseReady;

export const sendChat = async (city: string, name: string, text: string) => {
  const store = firebaseReady ? db() : null;
  const uid = await currentUid();
  if (!store || !uid) throw new Error("Chat is not available right now.");
  const problem = chatProblem(text);
  if (problem) throw new Error(problem);
  await addDoc(collection(store, "chat"), {
    city, uid, name: name || "someone",
    text: text.trim().replace(/\s+/g, " ").slice(0, 240),
    at: Date.now(),
    sent: serverTimestamp(),
  });
};

export const watchChat = (city: string, onChange: (lines: ChatLine[]) => void) => {
  const store = firebaseReady ? db() : null;
  if (!store) return () => {};
  const q = query(collection(store, "chat"), where("city", "==", city), orderBy("at", "desc"), limit(50));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChatLine, "id">) })).reverse());
  }, () => onChange([]));
};

export const myUid = currentUid;
