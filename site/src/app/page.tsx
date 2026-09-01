"use client";

import { useState, useRef, MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword, deleteUser, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import styles from "./page.module.css";

const initialForm = {
  username: "",
  password: "",
  firstName: "",
  lastName: "",
  phone: "",
  age: "",
  relationshipStatus: "โสด",
  role: "Member",
};

type FormState = typeof initialForm;

function usernameEmail(username: string): string {
  return `${username.toLowerCase()}@auth.domeright.local`;
}

export default function HomePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"signup" | "login">("signup");
  const [form, setForm] = useState<FormState>(initialForm);
  const [loginData, setLoginData] = useState({ username: "", password: "" });
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const shellRef = useRef<HTMLDivElement>(null);

  async function withTimeout<T>(operation: () => Promise<T>, errorMessage: string, timeoutMs = 15000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!shellRef.current || window.innerWidth <= 900) return;
    
    const shell = shellRef.current;
    const rect = shell.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const rotateX = ((y - centerY) / centerY) * -5; 
    const rotateY = ((x - centerX) / centerX) * 5;

    shell.style.setProperty('--mouse-x', `${x}px`);
    shell.style.setProperty('--mouse-y', `${y}px`);
    shell.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  };

  const handleMouseLeave = () => {
    if (!shellRef.current) return;
    const shell = shellRef.current;
    shell.style.transform = `rotateX(0deg) rotateY(0deg)`;
    shell.style.setProperty('--mouse-x', `50%`);
    shell.style.setProperty('--mouse-y', `50%`);
  };

  const handleSignup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const trimmed = {
        username: form.username.trim(),
        password: form.password.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.trim(),
        age: form.age.trim(),
        relationshipStatus: form.relationshipStatus || "โสด",
        role: "Member",
      };

      if (Object.values(trimmed).some((value) => !value)) {
        throw new Error("กรุณากรอกข้อมูลให้ครบทุกช่อง");
      }
      if (!/^[a-zA-Z0-9._-]{3,32}$/.test(trimmed.username)) {
        throw new Error("username ต้องมี 3-32 ตัว และใช้ได้เฉพาะ a-z, 0-9, จุด, ขีด หรือ underscore");
      }

      const credential = await withTimeout(
        () => createUserWithEmailAndPassword(auth, usernameEmail(trimmed.username), trimmed.password),
        "เชื่อมต่อ Firebase ล่าช้า กรุณาลองใหม่อีกครั้ง",
      );

      try {
        await withTimeout(
          () => setDoc(doc(db, "members", credential.user.uid), {
            username: trimmed.username,
            firstName: trimmed.firstName,
            lastName: trimmed.lastName,
            phone: trimmed.phone,
            age: trimmed.age,
            relationshipStatus: trimmed.relationshipStatus,
            role: trimmed.role,
            createdAt: new Date().toISOString(),
          }),
          "การบันทึกข้อมูลล่าช้า กรุณาลองใหม่อีกครั้ง",
        );
      } catch (error) {
        await deleteUser(credential.user).catch(() => undefined);
        throw error;
      }

      localStorage.setItem("gangUsername", trimmed.username);
      sessionStorage.setItem("gangUsername", trimmed.username);
      window.dispatchEvent(new Event("gang-auth-changed"));
      setMessage({ type: "success", text: "สมัครสมาชิกสำเร็จแล้ว" });
      setForm(initialForm);
      router.push("/members");
    } catch (error) {
      const rawText = error instanceof Error ? error.message : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
      const text = rawText.includes("auth/email-already-in-use")
        ? "username นี้ถูกใช้แล้ว"
        : rawText.includes("auth/weak-password")
          ? "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"
          : rawText.includes("permission-denied")
            ? "Firebase Rules ปิดกั้นการบันทึกข้อมูล"
            : rawText;
      setMessage({ type: "error", text });
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const username = loginData.username.trim();
      const password = loginData.password.trim();
      if (!username || !password) {
        throw new Error("กรุณากรอก username และ password");
      }

      const credential = await withTimeout(
        () => signInWithEmailAndPassword(auth, usernameEmail(username), password),
        "เชื่อมต่อ Firebase ล่าช้า กรุณาลองใหม่อีกครั้ง",
      );

      const memberSnapshot = await withTimeout(
        () => getDoc(doc(db, "members", credential.user.uid)),
        "เชื่อมต่อ Firebase ล่าช้า กรุณาลองใหม่อีกครั้ง",
      );
      if (!memberSnapshot.exists()) {
        throw new Error("ไม่พบข้อมูลสมาชิก กรุณาติดต่อผู้ดูแลระบบ");
      }

      localStorage.setItem("gangUsername", username);
      sessionStorage.setItem("gangUsername", username);
      window.dispatchEvent(new Event("gang-auth-changed"));

      setMessage({ type: "success", text: "เข้าสู่ระบบสำเร็จ ยินดีต้อนรับสู่ DOMERIGHT GANG" });
      setLoginData({ username: "", password: "" });
      router.push("/members");
    } catch (error) {
      const rawText = error instanceof Error ? error.message : "เข้าสู่ระบบล้มเหลว";
      const text = rawText.startsWith("ไม่พบข้อมูลสมาชิก")
        ? rawText
        : rawText.includes("auth/invalid-credential") || rawText.includes("auth/user-not-found") || rawText.includes("auth/wrong-password")
          ? "username หรือ password ไม่ถูกต้อง"
          : rawText;
      setMessage({ type: "error", text });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.particle} style={{ left: '10%', width: '40px', height: '40px', animationDelay: '0s' }} />
      <div className={styles.particle} style={{ left: '80%', width: '80px', height: '80px', animationDelay: '4s' }} />
      <div className={styles.particle} style={{ left: '40%', width: '20px', height: '20px', animationDelay: '8s' }} />

      <main 
        ref={shellRef}
        className={styles["auth-shell"]}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <div className={styles["brand-stage"]}>
          <div>
            <div className={styles["brand-mark"]} aria-hidden="true">
              <div className={styles["brand-ring-outer"]} />
              <div className={styles["brand-ring-inner"]} />
              <div className={styles["brand-core"]} />
            </div>
            
            <div className={styles["big-title-wrap"]}>
              <h1>DOMERIGHT</h1>
              <p>RESPECT IS EARNED FEAR IS GUARANTEED</p>
            </div>
          </div>

          <div className={styles["community-copy"]}>
            <p className={styles["tiny-label"]}>FiveM Community</p>
            <h2>DOMERIGHT GANG</h2>
            <ul className={styles["feature-list"]}>
              <li>Secure Access</li>
              <li>Live Members</li>
              <li>Elite Crew</li>
            </ul>
          </div>
        </div>

        <section className={styles["auth-panel"]}>
          <div className={styles.switcher} role="tablist" aria-label="Authentication tabs">
            <button
              type="button"
              className={activeTab === "signup" ? styles.active : ""}
              onClick={() => {
                setActiveTab("signup");
                setMessage(null);
              }}
            >
              สมัครสมาชิก
            </button>
            <button
              type="button"
              className={activeTab === "login" ? styles.active : ""}
              onClick={() => {
                setActiveTab("login");
                setMessage(null);
              }}
            >
              Login
            </button>
          </div>

          {activeTab === "signup" ? (
            <form className={styles["auth-form"]} onSubmit={handleSignup}>
              <div className={styles["form-grid"]}>
                <label>
                  <span>Username</span>
                  <input
                    id="signupUsername"
                    name="username"
                    value={form.username}
                    onChange={(event) => setForm({ ...form, username: event.target.value })}
                    placeholder="Username"
                  />
                </label>

                <label>
                  <span>Password IC</span>
                  <input
                    id="signupPassword"
                    name="password"
                    type="password"
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    placeholder="Password IC"
                  />
                </label>

                <label>
                  <span>ชื่อ IC</span>
                  <input
                    id="signupFirstName"
                    name="firstName"
                    value={form.firstName}
                    onChange={(event) => setForm({ ...form, firstName: event.target.value })}
                    placeholder="ชื่อ IC"
                  />
                </label>

                <label>
                  <span>นามสกุล IC</span>
                  <input
                    id="signupLastName"
                    name="lastName"
                    value={form.lastName}
                    onChange={(event) => setForm({ ...form, lastName: event.target.value })}
                    placeholder="นามสกุล IC"
                  />
                </label>

                <label>
                  <span>เบอร์โทร</span>
                  <input
                    id="signupPhone"
                    name="phone"
                    value={form.phone}
                    onChange={(event) => setForm({ ...form, phone: event.target.value })}
                    placeholder="เบอร์โทร"
                  />
                </label>

                <label>
                  <span>อายุ OC</span>
                  <input
                    id="signupAge"
                    name="age"
                    value={form.age}
                    onChange={(event) => setForm({ ...form, age: event.target.value })}
                    placeholder="อายุ OC"
                  />
                </label>

                <label>
                  <span>สถานะ</span>
                  <select
                    id="relationshipStatus"
                    name="relationshipStatus"
                    value={form.relationshipStatus}
                    onChange={(event) => setForm({ ...form, relationshipStatus: event.target.value })}
                  >
                    <option value="โสด">โสด</option>
                    <option value="มีแฟนแล้ว">มีแฟนแล้ว</option>
                  </select>
                </label>
              </div>

              {message && (
                <p className={`${styles.message} ${styles[message.type]}`}>{message.text}</p>
              )}

              <button type="submit" className={styles["submit-button"]} disabled={loading}>
                {loading ? "กำลังสมัคร..." : "สมัครสมาชิก"}
              </button>
            </form>
          ) : (
            <form className={styles["auth-form"]} onSubmit={handleLogin}>
              <label>
                <span>Username</span>
                <input
                  id="loginUsername"
                  name="username"
                  value={loginData.username}
                  onChange={(event) => setLoginData({ ...loginData, username: event.target.value })}
                  placeholder="Username"
                />
              </label>

              <label>
                <span>Password</span>
                <input
                  id="loginPassword"
                  name="password"
                  type="password"
                  value={loginData.password}
                  onChange={(event) => setLoginData({ ...loginData, password: event.target.value })}
                  placeholder="Password"
                />
              </label>

              {message && (
                <p className={`${styles.message} ${styles[message.type]}`}>{message.text}</p>
              )}

              <button type="submit" className={styles["submit-button"]} disabled={loading}>
                {loading ? "กำลังเข้าสู่ระบบ..." : "Login"}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}