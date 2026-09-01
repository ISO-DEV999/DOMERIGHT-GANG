"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import AuthGuard from "@/components/AuthGuard";
import styles from "./page.module.css";

type Member = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  phone: string;
  age: string;
  role: string;
  relationshipStatus: string;
  photoUrl?: string;
  fundStatus?: boolean;
  gangFundStatus?: "pending" | "approved" | "notSent";
  createdAt?: string;
};

type LeaveRecord = {
  username: string;
  startDate: string;
  endDate: string;
};

type GangFundRecord = {
  username: string;
  status?: "pending" | "approved";
  createdAt?: string;
};

const ROLE_ORDER = ["Leader", "Officer", "Member"] as const;
const ROLE_FILTERS = ["All", ...ROLE_ORDER] as const;
type RoleFilter = (typeof ROLE_FILTERS)[number];

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeRole, setActiveRole] = useState<RoleFilter>("All");
  const [tilt, setTilt] = useState({ x: 0, y: 0, mx: 50, my: 50 });
  const [scrollDepth, setScrollDepth] = useState(0);
  const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([]);
  const [gangFundRecords, setGangFundRecords] = useState<GangFundRecord[]>([]);
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    const handleScroll = () => {
      setScrollDepth(window.scrollY * 0.22);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "gangFunds"),
      (snapshot) => {
        setGangFundRecords(snapshot.docs.map((fundDoc) => fundDoc.data() as GangFundRecord));
      },
      (error) => console.error("Failed to load gang fund records:", error),
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "gangLeaves"),
      (snapshot) => {
        setLeaveRecords(snapshot.docs.map((leaveDoc) => leaveDoc.data() as LeaveRecord));
      },
      (error) => console.error("Failed to load leave records:", error),
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setToday(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const membersQuery = query(collection(db, "members"), orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(
      membersQuery,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as Omit<Member, "id">),
        }));

        setMembers(data);
        setLoading(false);
      },
      (error) => {
        console.error("Failed to load members:", error);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  const filteredMembers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return members.filter((member) => {
      const role = ROLE_ORDER.includes(member.role as (typeof ROLE_ORDER)[number])
        ? member.role
        : "Member";

      const matchesRole = activeRole === "All" || role === activeRole;
      const haystack = [member.firstName, member.lastName, member.username, member.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return matchesRole && (!normalizedSearch || haystack.includes(normalizedSearch));
    });
  }, [activeRole, members, search]);

  const groupedMembers = useMemo(() => {
    const grouped: Record<string, Member[]> = {
      Leader: [],
      Officer: [],
      Member: [],
    };

    filteredMembers.forEach((member) => {
      const role = member.role && ROLE_ORDER.includes(member.role as (typeof ROLE_ORDER)[number])
        ? member.role
        : "Member";

      grouped[role].push(member);
    });

    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => {
        const aName = `${a.firstName} ${a.lastName}`.toLowerCase();
        const bName = `${b.firstName} ${b.lastName}`.toLowerCase();
        return aName.localeCompare(bName);
      });
    });

    return grouped;
  }, [filteredMembers]);

  const roleCount = (role: (typeof ROLE_ORDER)[number]) =>
    members.filter((member) => {
      const normalizedRole = ROLE_ORDER.includes(member.role as (typeof ROLE_ORDER)[number])
        ? member.role
        : "Member";
      return normalizedRole === role;
    }).length;

  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const isMemberOnLeave = (username: string) => leaveRecords.some((leave) =>
    leave.username === username && leave.startDate <= todayKey && todayKey <= leave.endDate,
  );
  const getGangFundStatus = (username: string) => {
    const member = members.find((item) => item.username === username);
    if (member?.gangFundStatus === "approved") return { label: "ส่งเงินแล้ว", className: styles.gangFundSentStatus };
    if (member?.gangFundStatus === "pending") return { label: "รอตรวจสอบ", className: styles.gangFundPendingStatus };

    const latestFund = gangFundRecords
      .filter((fund) => fund.username === username)
      .sort((first, second) => new Date(second.createdAt || "").getTime() - new Date(first.createdAt || "").getTime())[0];

    if (!latestFund) return { label: "ยังไม่ได้ส่ง", className: styles.gangFundNotSentStatus };
    if (latestFund.status === "approved") return { label: "ส่งเงินแล้ว", className: styles.gangFundSentStatus };
    return { label: "รอตรวจสอบ", className: styles.gangFundPendingStatus };
  };

  const shellStyle = {
    ["--tilt-x" as string]: `${tilt.x}deg`,
    ["--tilt-y" as string]: `${tilt.y}deg`,
    ["--scroll-depth" as string]: `${scrollDepth}px`,
    ["--mx" as string]: `${tilt.mx}%`,
    ["--my" as string]: `${tilt.my}%`,
  } as CSSProperties;

  const handleShellMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    setTilt({
      x: (0.5 - y) * 10,
      y: (x - 0.5) * 14,
      mx: x * 100,
      my: y * 100,
    });
  };

  const resetShellTilt = () => setTilt({ x: 0, y: 0, mx: 50, my: 50 });

  // การ์ดสมาชิก: เอียง 3D + แสงสะท้อนตามเมาส์ แบบ HUD/holographic card
  // ใช้การเซ็ต style ตรงๆ (ไม่ผ่าน React state) เพื่อความลื่นไหลระดับ 60fps ไม่ต้อง re-render ทั้งหน้า
  // จำ rect ไว้ตอน mouseenter แทนที่จะเรียก getBoundingClientRect() ทุกครั้งที่ mousemove
  // เพราะถ้าหน้าเว็บมีการ reflow เล็กน้อยระหว่าง hover ค่า rect ที่วัดสดๆ อาจคลาดเคลื่อน
  // ทำให้คำนวณตำแหน่งเมาส์ผิด จนกล่องดูเหมือนหมุนหนีเมาส์ไปเอง (mouseleave หลอน)
  const cardRectsRef = useRef(new Map<Element, DOMRect>());

  const handleCardEnter = (event: React.MouseEvent<HTMLElement>) => {
    cardRectsRef.current.set(event.currentTarget, event.currentTarget.getBoundingClientRect());
  };

  const handleCardMove = (event: React.MouseEvent<HTMLElement>) => {
    const card = event.currentTarget;
    const rect = cardRectsRef.current.get(card) ?? card.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;

    card.style.setProperty("--card-rx", `${(0.5 - py) * 14}deg`);
    card.style.setProperty("--card-ry", `${(px - 0.5) * 16}deg`);
    card.style.setProperty("--card-mx", `${px * 100}%`);
    card.style.setProperty("--card-my", `${py * 100}%`);
    card.style.setProperty("--card-glow", "1");
  };

  const handleCardLeave = (event: React.MouseEvent<HTMLElement>) => {
    const card = event.currentTarget;
    cardRectsRef.current.delete(card);
    card.style.setProperty("--card-rx", "0deg");
    card.style.setProperty("--card-ry", "0deg");
    card.style.setProperty("--card-glow", "0");
  };

  return (
    <AuthGuard>
      <main className={styles.page}>
      <div className={styles.ambientGrid} aria-hidden="true" />
      <div className={`${styles.orb} ${styles.orbOne}`} aria-hidden="true" />
      <div className={`${styles.orb} ${styles.orbTwo}`} aria-hidden="true" />

      <div
        className={styles.shell}
        style={shellStyle}
        onMouseMove={handleShellMove}
        onMouseLeave={resetShellTilt}
      >
        <header className={styles.navbar}>
          <div className={styles.brandWrap}>
            <div className={styles.brandMark} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className={styles.brandTitle}>
              DOMERIGHT <span className={styles.dot}>.dev</span>
            </div>
          </div>

          <nav className={styles.navPillContainer} aria-label="Primary navigation">
            <Link href="/members" prefetch={false} className={`${styles.navItem} ${styles.active}`}>MEMBERS</Link>
            <Link href="/gang-money" prefetch={false} className={styles.navItem}>โทรศัพท์แก๊ง</Link>
          </nav>

          <div className={styles.navRight}>
            <div className={styles.livePill}>
              <span className={styles.liveDot} />
              LIVE DATA
            </div>
          </div>
        </header>

        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.kicker}>COMMUNITY / 2026</span>
            <h1>
              <span className={styles.typewriterText}>DOMERIGHT</span>
            </h1>

            <div className={styles.heroActions}>
              <div className={styles.searchBox}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m16 16 4 4" />
                </svg>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ค้นหาชื่อ, username หรือเบอร์..."
                  aria-label="ค้นหาสมาชิก"
                />
                {search && (
                  <button
                    type="button"
                    className={styles.clearSearch}
                    onClick={() => setSearch("")}
                    aria-label="ล้างคำค้นหา"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className={styles.filterPill} role="group" aria-label="กรองตามตำแหน่ง">
                {ROLE_FILTERS.map((role) => (
                  <button
                    type="button"
                    key={role}
                    className={`${styles.filterItem} ${activeRole === role ? styles.filterActive : ""}`}
                    onClick={() => setActiveRole(role)}
                  >
                    {role === "All" ? "ALL" : role.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.heroVisual} aria-hidden="true">
            <div className={styles.scene}>
              <div className={`${styles.ring} ${styles.ringOne}`} />
              <div className={`${styles.ring} ${styles.ringTwo}`} />
              <div className={`${styles.ring} ${styles.ringThree}`} />
              <div className={styles.core}>
                <span className={styles.coreGlow} />
              </div>
              <div className={styles.orbitDot} />
            </div>
            <div className={styles.visualLabel}>
              <span>MEMBER NETWORK</span>
              <strong>{filteredMembers.length.toString().padStart(2, "0")}</strong>
            </div>
          </div>
        </section>

        <section className={styles.statsRow} aria-label="สรุปสมาชิก">
          <div className={styles.statCard}>
            <span className={styles.statLabel}>TOTAL MEMBERS</span>
            <strong>{members.length}</strong>
            <span className={styles.statMeta}>สมาชิกทั้งหมด</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>LEADERSHIP</span>
            <strong>{roleCount("Leader") + roleCount("Officer")}</strong>
            <span className={styles.statMeta}>Leader + Officer</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>VISIBLE NOW</span>
            <strong>{filteredMembers.length}</strong>
            <span className={styles.statMeta}>ผลลัพธ์ที่แสดง</span>
          </div>
        </section>

        <div className={styles.sectionHeaderBar}>
          <div>
            <span className={styles.sectionEyebrow}>MEMBER DIRECTORY</span>
            <h2>สมาชิกทั้งหมดในแก๊ง</h2>
          </div>
          <div className={styles.resultCount}>{filteredMembers.length.toString().padStart(2, "0")} MEMBERS</div>
        </div>

        {loading ? (
          <div className={styles.loadingGrid}>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={styles.skeletonCard} />
            ))}
          </div>
        ) : (
          <div className={styles.contentBody}>
            {ROLE_ORDER.map((role) => {
              const items = groupedMembers[role] ?? [];
              if (!items.length) return null;

              return (
                <section key={role} className={styles.roleGroupSection}>
                  <div className={styles.roleSubHeader}>
                    <div className={styles.roleTitleWrap}>
                      <span className={`${styles.roleIndicator} ${styles[role.toLowerCase()]}`} />
                      <span>{role}S</span>
                      <em>{items.length.toString().padStart(2, "0")}</em>
                    </div>
                    <span className={styles.roleLine} />
                  </div>

                  <div className={styles.grid}>
                    {items.map((member, index) => {
                      const initials = `${member.firstName?.[0] ?? ""}${member.lastName?.[0] ?? ""}`
                        .toUpperCase() || "DR";

                      return (
                        <article
                          key={member.id}
                          className={`${styles.card} ${styles[role.toLowerCase()]}`}
                          onMouseEnter={handleCardEnter}
                          onMouseMove={handleCardMove}
                          onMouseLeave={handleCardLeave}
                        >
                          <div className={styles.cardTilt}>
                          <div className={styles.cardTopLine}>
                            <span>#{String(index + 1).padStart(2, "0")}</span>
                            <span className={styles.cardStatus}>ACTIVE</span>
                          </div>

                          <div className={styles.cardHeader}>
                            <div className={styles.avatarWrap}>
                              {member.photoUrl ? (
                                <img src={member.photoUrl} alt={`${member.firstName} ${member.lastName}`} className={styles.avatarImage} />
                              ) : (
                                <div className={styles.avatar}>{initials}</div>
                              )}
                            </div>
                            <div className={styles.userInfo}>
                              <h3>{member.firstName} {member.lastName}</h3>
                              <span className={styles.userSub}>@{member.username}</span>
                              <span className={styles.roleBadge}>{role.toUpperCase()}</span>
                            </div>
                          </div>

                          <div className={styles.cardDetails}>
                            <div className={styles.detailRow}>
                              <span className={styles.detailIcon} aria-hidden="true">📞</span>
                              <span>PHONE</span>
                              <strong>{member.phone || "-"}</strong>
                            </div>
                            <div className={styles.detailRow}>
                              <span className={styles.detailIcon} aria-hidden="true">❤️</span>
                              <span>STATUS</span>
                              <strong>{member.relationshipStatus || "โสด"}</strong>
                            </div>
                            <div className={styles.detailRow}>
                              <span className={styles.detailIcon} aria-hidden="true">◉</span>
                              <span>STATUS GANG</span>
                              <strong className={isMemberOnLeave(member.username) ? styles.gangLeaveStatus : styles.gangNormalStatus}>
                                {isMemberOnLeave(member.username) ? "ลา" : "ปกติ"}
                              </strong>
                            </div>
                            <div className={styles.detailRow}>
                              <span className={styles.detailIcon} aria-hidden="true">฿</span>
                              <span>ส่งเงินแก๊ง</span>
                              <strong className={getGangFundStatus(member.username).className}>
                                {getGangFundStatus(member.username).label}
                              </strong>
                            </div>
                          </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}

            {!filteredMembers.length && (
              <div className={styles.emptyState}>
                <div className={styles.emptyOrb} aria-hidden="true">?</div>
                <strong>ไม่พบสมาชิกที่ตรงกับการค้นหา</strong>
                <span>ลองเปลี่ยนคำค้นหา หรือเลือกตำแหน่งเป็น ALL</span>
              </div>
            )}
          </div>
        )}
      </div>
      </main>
    </AuthGuard>
  );
}