"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import styles from "./page.module.css";

type Member = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  phone: string;
  age: string;
  relationshipStatus: string;
  role: string;
  createdAt?: string;
};

const ROLE_OPTIONS = ["Leader", "Officer", "Member"] as const;
type RoleOption = (typeof ROLE_OPTIONS)[number];

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"All" | RoleOption>("All");
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});
  const [isDeleting, setIsDeleting] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await fetch("/api/admin/me", {
          cache: "no-store",
          credentials: "include",
        });
        setIsAuthenticated(response.ok);
      } catch {
        setIsAuthenticated(false);
      } finally {
        setAuthReady(true);
      }
    };

    void checkSession();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setMembers([]);
      return;
    }

    const q = query(collection(db, "members"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<Member, "id">),
        }));
        setMembers(list);
      },
      (error) => {
        console.error("Failed to load members:", error);
      },
    );

    return () => unsubscribe();
  }, [isAuthenticated]);

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return members.filter((member) => {
      const normalizedRole = ROLE_OPTIONS.includes(member.role as RoleOption)
        ? member.role
        : "Member";

      const matchesRole = roleFilter === "All" || normalizedRole === roleFilter;
      if (!matchesRole) return false;

      if (!query) return true;

      const haystack = [
        member.username,
        member.firstName,
        member.lastName,
        member.phone,
        normalizedRole,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [members, roleFilter, search]);

  const roleSummary = useMemo(() => {
    return {
      Leader: members.filter((member) => (ROLE_OPTIONS.includes(member.role as RoleOption) ? member.role : "Member") === "Leader").length,
      Officer: members.filter((member) => (ROLE_OPTIONS.includes(member.role as RoleOption) ? member.role : "Member") === "Officer").length,
      Member: members.filter((member) => (ROLE_OPTIONS.includes(member.role as RoleOption) ? member.role : "Member") === "Member").length,
    };
  }, [members]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError("");
    setIsSubmitting(true);

    try {
      const normalizedEmail = email.trim().replace(/[.\s]+$/g, "");
      const normalizedPassword = password.trim().replace(/[.\s]+$/g, "");

      const response = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          password: normalizedPassword,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "เข้าสู่ระบบล้มเหลว");
      }

      setIsAuthenticated(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "เข้าสู่ระบบล้มเหลว กรุณาลองใหม่อีกครั้ง";
      setLoginError(
        message.includes("auth/invalid-credential") || message.includes("auth/user-not-found")
          ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
          : message,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    setIsAuthenticated(false);
  };

  const updateMemberField = async (memberId: string, key: "firstName" | "lastName", value: string) => {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return;
    }

    setIsSaving((current) => ({ ...current, [memberId]: true }));

    try {
      await updateDoc(doc(db, "members", memberId), { [key]: trimmedValue });
    } catch (error) {
      console.error(`Failed to update ${key}:`, error);
      alert("อัปเดตข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsSaving((current) => ({ ...current, [memberId]: false }));
    }
  };

  const updateMemberRole = async (memberId: string, nextRole: RoleOption) => {
    setIsSaving((current) => ({ ...current, [memberId]: true }));

    try {
      await updateDoc(doc(db, "members", memberId), { role: nextRole });
    } catch (error) {
      console.error("Failed to update role:", error);
      alert("ปรับตำแหน่งยศไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsSaving((current) => ({ ...current, [memberId]: false }));
    }
  };

  const deleteMember = async (memberId: string, username: string) => {
    const confirmed = window.confirm(`ต้องการลบ user ${username} หรือไม่ ?`);
    if (!confirmed) return;

    setIsDeleting((current) => ({ ...current, [memberId]: true }));

    try {
      await deleteDoc(doc(db, "members", memberId));
    } catch (error) {
      console.error("Failed to delete member:", error);
      alert("ลบผู้ใช้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsDeleting((current) => ({ ...current, [memberId]: false }));
    }
  };

  if (!authReady) {
    return (
      <main className={styles.authLoadingShell}>
        <div className={styles.loadingBox}>Loading admin portal...</div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className={styles.loginPage}>
        <div className={styles.loginBackdrop} aria-hidden="true" />

        <section className={styles.loginPanel}>
          <div className={styles.loginHeader}>
            <div className={styles.brandBadge}>DG</div>
            <p className={styles.eyebrow}>ADMIN CONTROL</p>
            <h1>Backoffice Access</h1>
          </div>

          <form onSubmit={handleLogin} className={styles.loginForm}>
            <label>
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="iso112011@iso.com"
                autoComplete="email"
              />
            </label>

            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </label>

            {loginError ? <p className={styles.errorText}>{loginError}</p> : null}

            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "เข้าสู่ระบบ"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.pageShell}>
      <div className={styles.backgroundGlow} aria-hidden="true" />

      <header className={styles.topBar}>
        <div>
          <p className={styles.eyebrow}>DOMERIGHT GANG</p>
          <h1>Admin Management</h1>
        </div>

        <div className={styles.topBarRight}>
          <div className={styles.onlinePill}>● Online</div>
          <button type="button" className={styles.logoutButton} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <section className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span>Total Users</span>
          <strong>{members.length}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Leader</span>
          <strong>{roleSummary.Leader}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Officer</span>
          <strong>{roleSummary.Officer}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Member</span>
          <strong>{roleSummary.Member}</strong>
        </article>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ค้นหาชื่อ / username / เบอร์ / ยศ"
          />
        </div>

        <div className={styles.filterGroup} aria-label="Filter by role">
          {(["All", ...ROLE_OPTIONS] as const).map((filterOption) => (
            <button
              key={filterOption}
              type="button"
              className={roleFilter === filterOption ? styles.filterActive : styles.filterButton}
              onClick={() => setRoleFilter(filterOption)}
            >
              {filterOption === "All" ? "All" : filterOption}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.tableShell}>
        <div className={styles.tableHeader}>
          <span>Username</span>
          <span>First Name</span>
          <span>Last Name</span>
          <span>Role</span>
          <span>Phone</span>
          <span>Action</span>
        </div>

        {filteredMembers.length === 0 ? (
          <div className={styles.emptyState}>No members found</div>
        ) : (
          filteredMembers.map((member) => {
            const safeRole = ROLE_OPTIONS.includes(member.role as RoleOption)
              ? (member.role as RoleOption)
              : "Member";

            return (
              <div key={member.id} className={styles.memberRow}>
                <div className={styles.cellUsername}>{member.username}</div>

                <div className={styles.cellInput}>
                  <input
                    defaultValue={member.firstName}
                    onBlur={(event) => updateMemberField(member.id, "firstName", event.target.value)}
                  />
                </div>

                <div className={styles.cellInput}>
                  <input
                    defaultValue={member.lastName}
                    onBlur={(event) => updateMemberField(member.id, "lastName", event.target.value)}
                  />
                </div>

                <div className={styles.cellSelect}>
                  <select
                    value={safeRole}
                    onChange={(event) => updateMemberRole(member.id, event.target.value as RoleOption)}
                    disabled={isSaving[member.id]}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                </div>

                <div className={styles.cellPhone}>{member.phone}</div>

                <div className={styles.actionCell}>
                  <button
                    type="button"
                    className={styles.deleteButton}
                    onClick={() => deleteMember(member.id, member.username)}
                    disabled={isDeleting[member.id]}
                  >
                    {isDeleting[member.id] ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </section>
    </main>
  );
}
