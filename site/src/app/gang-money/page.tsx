"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, runTransaction, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import AuthGuard from "@/components/AuthGuard";
import wallpaper from "@/img/wallpaper.png";
import styles from "./page.module.css";

type TransactionType = "deposit" | "withdraw";
type AppScreen = "home" | "bank" | "messages" | "calculator" | "sendMoney" | "backoffice" | "leave" | "leaveLog" | "settings" | "inventory";

type Member = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  phone: string;
  relationshipStatus: string;
  gangFundStatus?: "pending" | "approved" | "notSent";
  balance?: number;
  photoUrl?: string;
};

type TransactionLog = {
  id: string;
  type: TransactionType;
  amount: number;
  message: string;
  username: string;
  firstName?: string;
  lastName?: string;
  createdAt?: string;
  source?: string;
  gangFundId?: string;
};

type GangFundLog = {
  id: string;
  amount: number;
  imageUrl: string;
  username: string;
  firstName?: string;
  lastName?: string;
  createdAt: string;
  status?: "pending" | "approved";
  approvedAt?: string;
  gangTransactionId?: string;
};

type LeaveLog = {
  id: string;
  reason: string;
  startDate: string;
  endDate: string;
  leaveDays: number;
  username: string;
  firstName: string;
  lastName: string;
  createdAt: string;
};

type InventoryItem = {
  id: string;
  name: string;
  quantity: number;
  imageUrl?: string;
  createdAt: string;
  updatedAt?: string;
};

type InventoryLogType = "create" | "add" | "withdraw" | "withdrawBatch";

// รายการย่อยของไอเทมที่ถูกเบิกพร้อมกันในล็อกแบบ "withdrawBatch"
type InventoryLogItemEntry = { itemId: string; itemName: string; amount: number };

type InventoryLog = {
  id: string;
  itemId: string;
  itemName: string;
  type: InventoryLogType;
  amount: number;
  remainingQuantity: number;
  // มีเฉพาะล็อกประเภท "withdrawBatch": รายการไอเทมทั้งหมดที่เบิกพร้อมกันในครั้งนี้
  items?: InventoryLogItemEntry[];
  username: string;
  firstName?: string;
  lastName?: string;
  note?: string;
  createdAt: string;
};

const initialForm = { amount: "", message: "" };

const getLeaveDays = (startDate: string, endDate: string) => {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
};

const BANGKOK_TZ = "Asia/Bangkok";

// แปลง Date เป็นสตริงวันที่ "YYYY-MM-DD" ตามโซนเวลาประเทศไทย (Asia/Bangkok)
// เพื่อให้ทุกเครื่องอ้างอิง "วันนี้" ตรงกันไม่ว่าเบราว์เซอร์จะตั้ง timezone อะไรไว้
const getBangkokDateString = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BANGKOK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  parts.forEach((part) => { map[part.type] = part.value; });
  return `${map.year}-${map.month}-${map.day}`;
};

// จัดรูปแบบ label วันที่แบบไทย (วันในสัปดาห์ + วันที่ + เดือน + ปี พ.ศ.) จากคีย์ "YYYY-MM-DD"
const formatBangkokDateLabel = (dateKey: string) => {
  const noonInBangkok = new Date(`${dateKey}T12:00:00+07:00`);
  return noonInBangkok.toLocaleDateString("th-TH", {
    timeZone: BANGKOK_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

type LeaveStatus = "upcoming" | "active" | "completed";

// สถานะการลา เทียบกับ "วันนี้" ตามเวลาไทย:
// - upcoming: ลาล่วงหน้า ยังไม่ถึงวันเริ่มลา
// - active: อยู่ในช่วงวันที่ลาพอดี (กำลังลา)
// - completed: พ้นวันสิ้นสุดการลาไปแล้ว
const getLeaveStatus = (leave: Pick<LeaveLog, "startDate" | "endDate">, todayKey: string): LeaveStatus => {
  if (todayKey < leave.startDate) return "upcoming";
  if (todayKey > leave.endDate) return "completed";
  return "active";
};

const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  upcoming: "รอเริ่มลา (ล่วงหน้า)",
  active: "กำลังลา",
  completed: "ลาครบกำหนดแล้ว",
};

const MAX_IMAGE_BYTES = 900_000;

// เกณฑ์แจ้งเตือน "ของใกล้หมด" ในตู้แก๊ง ถ้าคงเหลือ <= ค่านี้ (แต่มากกว่า 0) จะขึ้นสีเตือน
const LOW_STOCK_THRESHOLD = 3;

const compressImageForFirestore = (file: File) => new Promise<string>((resolve, reject) => {
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);

  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");

    if (!context) {
      reject(new Error("ไม่สามารถเตรียมรูปภาพได้"));
      return;
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = 0.82;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > MAX_IMAGE_BYTES && quality > 0.42) {
      quality -= 0.08;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }

    if (dataUrl.length > MAX_IMAGE_BYTES) {
      reject(new Error("รูปมีขนาดใหญ่เกินไป กรุณาเลือกรูปที่เล็กลง"));
      return;
    }
    resolve(dataUrl);
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error("ไฟล์รูปภาพไม่รองรับ"));
  };
  image.src = objectUrl;
});

const calculatorButtons = [
  { label: "AC", type: "top" }, { label: "±", type: "top" }, { label: "%", type: "top" }, { label: "÷", type: "side" },
  { label: "7", type: "num" }, { label: "8", type: "num" }, { label: "9", type: "num" }, { label: "×", type: "side" },
  { label: "4", type: "num" }, { label: "5", type: "num" }, { label: "6", type: "num" }, { label: "−", type: "side" },
  { label: "1", type: "num" }, { label: "2", type: "num" }, { label: "3", type: "num" }, { label: "+", type: "side" },
  { label: "0", type: "num", isWide: true }, { label: ".", type: "num" }, { label: "=", type: "side" },
];

export default function GangMoneyPage() {
  const [screen, setScreen] = useState<AppScreen>("home");
  const [isLocked, setIsLocked] = useState(true);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  
  const [selectedTab, setSelectedTab] = useState<TransactionType>("deposit");
  const [form, setForm] = useState(initialForm);
  const [member, setMember] = useState<Member | null>(null);
  const [memberDirectory, setMemberDirectory] = useState<Record<string, { photoUrl?: string; firstName?: string; lastName?: string }>>({});
  const [logs, setLogs] = useState<TransactionLog[]>([]);
  const [readLogIds, setReadLogIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isReasonSheetOpen, setIsReasonSheetOpen] = useState(false);
  const [isBackOfficePinOpen, setIsBackOfficePinOpen] = useState(false);
  const [backOfficePin, setBackOfficePin] = useState("");
  const [checkingBackOfficePin, setCheckingBackOfficePin] = useState(false);
  const [isWalletPinOpen, setIsWalletPinOpen] = useState(false);
  const [walletPin, setWalletPin] = useState("");
  const [checkingWalletPin, setCheckingWalletPin] = useState(false);
  
  // States สำหรับระบบส่งเงินแก๊ง
  const [fundAmount, setFundAmount] = useState("");
  const [fundImage, setFundImage] = useState<File | null>(null);
  const [fundImagePreview, setFundImagePreview] = useState<string | null>(null);
  const [fundLogs, setFundLogs] = useState<GangFundLog[]>([]);
  const [gangBankBalance, setGangBankBalance] = useState(0);
  const [approvingFundId, setApprovingFundId] = useState<string | null>(null);
  const [deletingFundId, setDeletingFundId] = useState<string | null>(null);
  const [resettingFundRound, setResettingFundRound] = useState(false);
  const [brokenSlipIds, setBrokenSlipIds] = useState<Set<string>>(new Set());
  const [isLeaveLogPinOpen, setIsLeaveLogPinOpen] = useState(false);
  const [leaveLogPin, setLeaveLogPin] = useState("");
  const [checkingLeaveLogPin, setCheckingLeaveLogPin] = useState(false);
  const [leaveReason, setLeaveReason] = useState("");
  const [leaveStartDate, setLeaveStartDate] = useState("");
  const [leaveEndDate, setLeaveEndDate] = useState("");
  const [leaveLogs, setLeaveLogs] = useState<LeaveLog[]>([]);
  const [settingsFirstName, setSettingsFirstName] = useState("");
  const [settingsLastName, setSettingsLastName] = useState("");
  const [settingsPhone, setSettingsPhone] = useState("");
  const [settingsRelationshipStatus, setSettingsRelationshipStatus] = useState("โสด");
  const [settingsPhotoFile, setSettingsPhotoFile] = useState<File | null>(null);
  const [settingsPhotoPreview, setSettingsPhotoPreview] = useState<string | null>(null);

  // States สำหรับระบบตู้แก๊ง (Inventory)
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [inventoryLogs, setInventoryLogs] = useState<InventoryLog[]>([]);
  const [inventorySearch, setInventorySearch] = useState("");
  const [brokenItemImageIds, setBrokenItemImageIds] = useState<Set<string>>(new Set());
  const [isAddItemSheetOpen, setIsAddItemSheetOpen] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemQuantity, setNewItemQuantity] = useState("");
  const [newItemImage, setNewItemImage] = useState<File | null>(null);
  const [newItemImagePreview, setNewItemImagePreview] = useState<string | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [isStockSheetOpen, setIsStockSheetOpen] = useState(false);
  const [stockSheetMode, setStockSheetMode] = useState<"add" | "withdraw">("add");
  const [stockSheetItem, setStockSheetItem] = useState<InventoryItem | null>(null);
  const [stockAmount, setStockAmount] = useState("");
  const [stockNote, setStockNote] = useState("");
  const [processingStockItemId, setProcessingStockItemId] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  // ตู้แก๊ง: โหมด "เบิกของหลายชิ้น" — เลือกจำนวนแต่ละไอเทมไว้ก่อน แล้วค่อยยืนยันทีเดียว
  const [isWithdrawMode, setIsWithdrawMode] = useState(false);
  const [withdrawCart, setWithdrawCart] = useState<Record<string, number>>({});
  const [isWithdrawCartSheetOpen, setIsWithdrawCartSheetOpen] = useState(false);
  const [withdrawCartNote, setWithdrawCartNote] = useState("");
  const [submittingWithdrawCart, setSubmittingWithdrawCart] = useState(false);

  // Dynamic Island State
  const [islandAlert, setIslandAlert] = useState<string | null>(null);

  // Calculator State
  const [calcDisplay, setCalcDisplay] = useState("0");
  const [calcValue, setCalcValue] = useState<number | null>(null);
  const [calcOperator, setCalcOperator] = useState<string | null>(null);
  const [calcWaiting, setCalcWaiting] = useState(false);

  // นาฬิกา Real-time
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const savedReadLogIds = localStorage.getItem("gangReadLogIds");
    if (savedReadLogIds) {
      try {
        setReadLogIds(JSON.parse(savedReadLogIds) as string[]);
      } catch {
        localStorage.removeItem("gangReadLogIds");
      }
    }
  }, []);

  useEffect(() => {
    const unsubscribeTransactions = onSnapshot(
      collection(db, "gangTransactions"),
      (snapshot) => {
        const transactionLogs = snapshot.docs.map((transactionDoc) => ({
          id: transactionDoc.id,
          ...(transactionDoc.data() as Omit<TransactionLog, "id">),
        }));
        transactionLogs.sort((first, second) =>
          new Date(second.createdAt || "").getTime() - new Date(first.createdAt || "").getTime(),
        );
        setLogs(transactionLogs);
      },
      (error) => console.error("Error watching transaction logs", error),
    );
    const unsubscribeBank = onSnapshot(
      doc(db, "gangBank", "summary"),
      (snapshot) => setGangBankBalance(Number(snapshot.data()?.total || 0)),
      (error) => console.error("Error watching gang bank", error),
    );
    // ไดเรกทอรีรูปโปรไฟล์ของสมาชิกทุกคน อัปเดตเรียลไทม์ผ่าน onSnapshot
    // เพื่อให้หน้า Log ลา / Back Office ดึงรูปที่ตั้งค่าล่าสุดของแต่ละคนมาแสดงตรงกันทุกเครื่อง
    const unsubscribeMembers = onSnapshot(
      collection(db, "members"),
      (snapshot) => {
        const directory: Record<string, { photoUrl?: string; firstName?: string; lastName?: string }> = {};
        snapshot.docs.forEach((memberDoc) => {
          const data = memberDoc.data() as any;
          if (data.username) {
            directory[data.username] = {
              photoUrl: data.photoUrl || "",
              firstName: data.firstName || "",
              lastName: data.lastName || "",
            };
          }
        });
        setMemberDirectory(directory);
      },
      (error) => console.error("Error watching member directory", error),
    );

    // ตู้แก๊ง (Inventory): ทั้งรายการไอเทมและ log การเบิก/เติม อัปเดตเรียลไทม์
    // เพื่อให้ทุกคนเห็นจำนวนคงเหลือและประวัติตรงกันทันทีที่มีใครกดเบิก/เติมของ
    const unsubscribeInventoryItems = onSnapshot(
      collection(db, "gangInventory"),
      (snapshot) => {
        const items = snapshot.docs.map((itemDoc) => ({
          id: itemDoc.id,
          ...(itemDoc.data() as Omit<InventoryItem, "id">),
        }));
        items.sort((a, b) => a.name.localeCompare(b.name, "th"));
        setInventoryItems(items);
      },
      (error) => console.error("Error watching inventory items", error),
    );
    const unsubscribeInventoryLogs = onSnapshot(
      collection(db, "gangInventoryLogs"),
      (snapshot) => {
        const invLogs = snapshot.docs.map((logDoc) => ({
          id: logDoc.id,
          ...(logDoc.data() as Omit<InventoryLog, "id">),
        }));
        invLogs.sort((a, b) => new Date(b.createdAt || "").getTime() - new Date(a.createdAt || "").getTime());
        setInventoryLogs(invLogs);
      },
      (error) => console.error("Error watching inventory logs", error),
    );

    return () => {
      unsubscribeTransactions();
      unsubscribeBank();
      unsubscribeMembers();
      unsubscribeInventoryItems();
      unsubscribeInventoryLogs();
    };
  }, []);

  const formattedTime = currentTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  const formattedDate = currentTime.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' });

  useEffect(() => {
    const username = localStorage.getItem("gangUsername") || sessionStorage.getItem("gangUsername");
    if (!username) {
      setLoading(false);
      showIslandAlert("กรุณาเข้าสู่ระบบก่อนทำธุรกรรม");
      return;
    }

    const loadMemberAndData = async () => {
      try {
        const q = query(collection(db, "members"), where("username", "==", username));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const memberData = snapshot.docs[0].data() as any;
          setMember({
            id: snapshot.docs[0].id,
            username,
            firstName: memberData.firstName || "",
            lastName: memberData.lastName || "",
            phone: memberData.phone || "",
            balance: Number(memberData.balance || 0),
            relationshipStatus: memberData.relationshipStatus || "โสด",
            photoUrl: memberData.photoUrl || "",
          });

          // โหลด Logs เงินกองกลาง (ดึงทั้งหมดเพื่อแสดงในหน้า Backoffice)
          await loadFundLogs();
          await loadGangBank();
          await loadLeaveLogs();
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    void loadMemberAndData();
  }, []);

  const loadFundLogs = async () => {
    try {
      const fundSnapshot = await getDocs(collection(db, "gangFunds"));
      const funds = fundSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GangFundLog));
      
      // เรียงจากใหม่ไปเก่า
      funds.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setFundLogs(funds);
    } catch (err) {
      console.error("Error loading fund logs", err);
    }
  };

  const loadGangBank = async () => {
    try {
      const bankSnapshot = await getDoc(doc(db, "gangBank", "summary"));
      setGangBankBalance(Number(bankSnapshot.data()?.total || 0));
    } catch (err) {
      console.error("Error loading gang bank", err);
    }
  };

  const loadLeaveLogs = async () => {
    try {
      const leaveSnapshot = await getDocs(collection(db, "gangLeaves"));
      const leaves = leaveSnapshot.docs.map((leaveDoc) => ({
        id: leaveDoc.id,
        ...(leaveDoc.data() as Omit<LeaveLog, "id">),
      }));
      leaves.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setLeaveLogs(leaves);
    } catch (error) {
      console.error("Error loading leave logs", error);
    }
  };

  // ยอดเงินกองกลาง = Single Source of Truth เดียวคือ gangBank/summary
  // ดึงผ่าน onSnapshot แบบเรียลไทม์ ทุกเครื่อง/ทุก user จึงเห็นค่าตรงกันเสมอ
  // (เดิมมี fallback ไปใช้ member.balance รายคน ทำให้แต่ละ user เห็นยอดไม่ตรงกัน จึงตัดออก)
  const totalBalance = gangBankBalance;
  const unreadMessageCount = logs.filter((log) => !readLogIds.includes(log.id)).length;

  // กรองรายการไอเทมตามคำค้นหา (ไม่สนตัวพิมพ์เล็ก/ใหญ่ ตัดช่องว่างหัวท้าย)
  const filteredInventoryItems = (() => {
    const keyword = inventorySearch.trim().toLowerCase();
    if (!keyword) return inventoryItems;
    return inventoryItems.filter((item) => item.name.toLowerCase().includes(keyword));
  })();

  // "วันนี้" ตามเวลาไทย อิงจาก currentTime ที่นับทุกวินาที เพื่อให้พอข้ามเที่ยงคืนแล้ว
  // หมวดวันที่และสถานะการลา (upcoming/active/completed) จะขยับตามโดยอัตโนมัติโดยไม่ต้องรีเฟรชหน้า
  const todayBangkokKey = getBangkokDateString(currentTime);

  // จัดกลุ่มประวัติการลาแยกเป็นตาราง/หมวดตามวันที่ยื่นเรื่อง (อิงเวลาไทย)
  // พอขึ้นวันใหม่ รายการที่ยื่นในวันใหม่จะไปอยู่คนละหมวดโดยอัตโนมัติ ส่วนยอด "ลาสะสม" ต่อคนยังคำนวณจากประวัติทั้งหมดเหมือนเดิม ไม่ผูกกับหมวดวัน
  const leaveLogGroups = (() => {
    const groups: { dateKey: string; items: LeaveLog[] }[] = [];
    const indexByKey = new Map<string, number>();
    leaveLogs.forEach((leave) => {
      const key = leave.createdAt ? getBangkokDateString(new Date(leave.createdAt)) : "ไม่ทราบวันที่ยื่น";
      if (!indexByKey.has(key)) {
        indexByKey.set(key, groups.length);
        groups.push({ dateKey: key, items: [] });
      }
      groups[indexByKey.get(key)!].items.push(leave);
    });
    return groups;
  })();

  const showIslandAlert = (message: string) => {
    setIslandAlert(message);
    setTimeout(() => setIslandAlert(null), 3000);
  };

  const openTransactionSheet = (type: TransactionType) => {
    setSelectedTab(type);
    setForm(initialForm);
    setIsReasonSheetOpen(true);
    setIslandAlert(null);
  };

  const openMessages = () => {
    const allLogIds = logs.map((log) => log.id);
    setReadLogIds(allLogIds);
    localStorage.setItem("gangReadLogIds", JSON.stringify(allLogIds));
    setScreen("messages");
  };

  // เก็บค่า settingsPhotoPreview ล่าสุดไว้ใน ref เพื่อ revoke object URL ได้ถูกตัว
  // ไม่ว่าจะปิด/เปิดหน้า Settings ซ้ำ, บันทึกสำเร็จ, หรือ component unmount
  // (บัคเดิม: revoke เฉพาะตอนเลือกรูปใหม่ในหน้า Settings เท่านั้น ถ้าเปิดหน้าซ้ำหรือบันทึกเสร็จ
  //  แล้วไม่ได้เข้ามาเลือกรูปอีก object URL ก้อนเก่าจะไม่ถูก revoke เลย เกิด memory leak สะสม)
  const settingsPhotoPreviewRef = useRef<string | null>(null);
  useEffect(() => {
    settingsPhotoPreviewRef.current = settingsPhotoPreview;
  }, [settingsPhotoPreview]);

  useEffect(() => {
    return () => {
      if (settingsPhotoPreviewRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(settingsPhotoPreviewRef.current);
      }
    };
  }, []);

  const revokeSettingsPhotoPreview = () => {
    if (settingsPhotoPreviewRef.current?.startsWith("blob:")) {
      URL.revokeObjectURL(settingsPhotoPreviewRef.current);
    }
  };

  const openSettings = () => {
    if (!member) return;
    // เคลียร์ object URL ก้อนเก่า (ถ้ามีจากการเลือกรูปค้างไว้ก่อนหน้าที่ไม่ได้บันทึก) ก่อนเปิดหน้าใหม่
    revokeSettingsPhotoPreview();
    setSettingsFirstName(member.firstName);
    setSettingsLastName(member.lastName);
    setSettingsPhone(member.phone);
    setSettingsRelationshipStatus(member.relationshipStatus || "โสด");
    setSettingsPhotoFile(null);
    setSettingsPhotoPreview(member.photoUrl || null);
    setScreen("settings");
  };

  const handleSettingsPhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showIslandAlert("กรุณาเลือกไฟล์รูปภาพ");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showIslandAlert("รูปใหญ่เกิน 10 MB");
      return;
    }
    setSettingsPhotoFile(file);
    // เคลียร์ object URL รูปตัวอย่างก่อนหน้า (ถ้าเป็น blob) ป้องกัน memory leak เวลาเลือกรูปใหม่ซ้ำๆ
    setSettingsPhotoPreview((prevUrl) => {
      if (prevUrl && prevUrl.startsWith("blob:")) URL.revokeObjectURL(prevUrl);
      return URL.createObjectURL(file);
    });
  };

  const saveSettings = async () => {
    if (!member) return;
    if (!settingsFirstName.trim() || !settingsLastName.trim()) {
      showIslandAlert("กรุณากรอกชื่อและนามสกุล");
      return;
    }
    setSubmitting(true);
    try {
      const photoUrl = settingsPhotoFile
        ? await compressImageForFirestore(settingsPhotoFile)
        : (member.photoUrl || "");
      const updatedMember = {
        ...member,
        firstName: settingsFirstName.trim(),
        lastName: settingsLastName.trim(),
        phone: settingsPhone.trim(),
        photoUrl,
        relationshipStatus: settingsRelationshipStatus,
      };
      await updateDoc(doc(db, "members", member.id), {
        firstName: updatedMember.firstName,
        lastName: updatedMember.lastName,
        phone: updatedMember.phone,
        relationshipStatus: settingsRelationshipStatus,
        photoUrl,
      });
      // บันทึกสำเร็จแล้ว รูปถูก persist เป็น data URL ใน Firestore แล้ว
      // ไม่ต้องใช้ object URL preview ก้อนเดิมอีกต่อไป เคลียร์ทิ้งกันหลุด
      revokeSettingsPhotoPreview();
      setSettingsPhotoFile(null);
      setSettingsPhotoPreview(photoUrl || null);
      setMember(updatedMember);
      showIslandAlert("บันทึกการตั้งค่าแล้ว");
      setScreen("home");
    } catch (error) {
      console.error(error);
      showIslandAlert(error instanceof Error ? error.message : "บันทึกการตั้งค่าไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };

  // ===================== ตู้แก๊ง (Inventory) =====================

  const openInventory = () => {
    setInventorySearch("");
    cancelWithdrawMode();
    setScreen("inventory");
  };

  // เก็บค่า newItemImagePreview ล่าสุดไว้ใน ref เพื่อ revoke object URL ได้ถูกตัว
  // ป้องกัน memory leak แบบเดียวกับ fundImagePreview / settingsPhotoPreview
  const newItemImagePreviewRef = useRef<string | null>(null);
  useEffect(() => {
    newItemImagePreviewRef.current = newItemImagePreview;
  }, [newItemImagePreview]);

  useEffect(() => {
    return () => {
      if (newItemImagePreviewRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(newItemImagePreviewRef.current);
      }
    };
  }, []);

  const revokeNewItemImagePreview = () => {
    if (newItemImagePreviewRef.current?.startsWith("blob:")) {
      URL.revokeObjectURL(newItemImagePreviewRef.current);
    }
  };

  const resetNewItemForm = () => {
    revokeNewItemImagePreview();
    setNewItemName("");
    setNewItemQuantity("");
    setNewItemImage(null);
    setNewItemImagePreview(null);
  };

  const openAddItemSheet = () => {
    resetNewItemForm();
    setIsAddItemSheetOpen(true);
    setIslandAlert(null);
  };

  const closeAddItemSheet = () => {
    setIsAddItemSheetOpen(false);
    resetNewItemForm();
  };

  const handleNewItemImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showIslandAlert("❌ กรุณาเลือกไฟล์รูปภาพ");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showIslandAlert("❌ รูปใหญ่เกิน 10 MB");
      return;
    }
    setNewItemImage(file);
    setNewItemImagePreview((prevUrl) => {
      if (prevUrl?.startsWith("blob:")) URL.revokeObjectURL(prevUrl);
      return URL.createObjectURL(file);
    });
  };

  const submitNewItem = async () => {
    if (!member) return showIslandAlert("กรุณาเข้าสู่ระบบ");
    const trimmedName = newItemName.trim();
    if (!trimmedName) return showIslandAlert("❌ กรุณากรอกชื่อไอเทม");

    const quantity = Number(newItemQuantity);
    if (!Number.isFinite(quantity) || quantity < 0) return showIslandAlert("❌ กรุณากรอกจำนวนให้ถูกต้อง");

    // กันเพิ่มไอเทมชื่อซ้ำ (ไม่สนตัวพิมพ์เล็ก/ใหญ่ ตัดช่องว่างหัวท้าย)
    // เพื่อไม่ให้ของชิ้นเดียวกันแยกเป็นหลายรายการ สับสนตอนเบิก
    const isDuplicate = inventoryItems.some(
      (item) => item.name.trim().toLowerCase() === trimmedName.toLowerCase(),
    );
    if (isDuplicate) {
      showIslandAlert("❌ มีไอเทมชื่อนี้อยู่แล้ว กดเพิ่มจำนวนของเดิมแทน");
      return;
    }

    setSavingItem(true);
    try {
      const imageUrl = newItemImage ? await compressImageForFirestore(newItemImage) : "";
      const itemRef = doc(collection(db, "gangInventory"));
      const createdAt = new Date().toISOString();

      await setDoc(itemRef, {
        name: trimmedName,
        quantity,
        imageUrl,
        createdAt,
        updatedAt: createdAt,
      });
      await addDoc(collection(db, "gangInventoryLogs"), {
        itemId: itemRef.id,
        itemName: trimmedName,
        type: "create" as const,
        amount: quantity,
        remainingQuantity: quantity,
        username: member.username,
        firstName: member.firstName,
        lastName: member.lastName,
        note: "เพิ่มไอเทมใหม่เข้าตู้แก๊ง",
        createdAt,
      });

      showIslandAlert("✅ เพิ่มไอเทมใหม่แล้ว");
      closeAddItemSheet();
    } catch (error) {
      console.error(error);
      showIslandAlert(error instanceof Error ? `❌ ${error.message}` : "❌ เพิ่มไอเทมไม่สำเร็จ");
    } finally {
      setSavingItem(false);
    }
  };

  const openStockSheet = (item: InventoryItem, mode: "add" | "withdraw") => {
    setStockSheetItem(item);
    setStockSheetMode(mode);
    setStockAmount("");
    setStockNote("");
    setIsStockSheetOpen(true);
    setIslandAlert(null);
  };

  const submitStockChange = async () => {
    if (!member) return showIslandAlert("กรุณาเข้าสู่ระบบ");
    if (!stockSheetItem) return;

    const amount = Number(stockAmount);
    if (!amount || amount <= 0) return showIslandAlert("❌ กรุณากรอกจำนวนให้ถูกต้อง");

    const isWithdraw = stockSheetMode === "withdraw";
    const itemId = stockSheetItem.id;

    setProcessingStockItemId(itemId);
    try {
      const itemRef = doc(db, "gangInventory", itemId);
      const logRef = doc(collection(db, "gangInventoryLogs"));
      const createdAt = new Date().toISOString();
      const note = stockNote.trim();

      await runTransaction(db, async (transaction) => {
        const itemSnapshot = await transaction.get(itemRef);
        if (!itemSnapshot.exists()) throw new Error("ไม่พบไอเทมนี้แล้ว");

        const itemData = itemSnapshot.data() as Omit<InventoryItem, "id">;
        const currentQuantity = Number(itemData.quantity || 0);

        if (isWithdraw && currentQuantity < amount) {
          throw new Error("ของไม่พอเบิก");
        }

        const nextQuantity = isWithdraw ? currentQuantity - amount : currentQuantity + amount;

        transaction.update(itemRef, { quantity: nextQuantity, updatedAt: createdAt });
        transaction.set(logRef, {
          itemId,
          itemName: itemData.name,
          type: isWithdraw ? "withdraw" : "add",
          amount,
          remainingQuantity: nextQuantity,
          username: member.username,
          firstName: member.firstName,
          lastName: member.lastName,
          note,
          createdAt,
        });
      });

      showIslandAlert(isWithdraw ? `✅ เบิก ${stockSheetItem.name} แล้ว` : `✅ เติมของ ${stockSheetItem.name} แล้ว`);
      setIsStockSheetOpen(false);
      setStockSheetItem(null);
      setStockAmount("");
      setStockNote("");
    } catch (error) {
      console.error(error);
      const message = error instanceof Error && error.message === "ของไม่พอเบิก" ? "❌ ของไม่พอเบิก" : "❌ บันทึกไม่สำเร็จ";
      showIslandAlert(message);
    } finally {
      setProcessingStockItemId(null);
    }
  };

  const deleteInventoryItem = async (item: InventoryItem) => {
    if (!window.confirm(`ต้องการลบไอเทม "${item.name}" ออกจากตู้แก๊งใช่หรือไม่?`)) return;

    setDeletingItemId(item.id);
    try {
      await deleteDoc(doc(db, "gangInventory", item.id));
      showIslandAlert("✅ ลบไอเทมแล้ว");
    } catch (error) {
      console.error(error);
      showIslandAlert("❌ ลบไอเทมไม่สำเร็จ");
    } finally {
      setDeletingItemId(null);
    }
  };

  // ===================== ตู้แก๊ง: เบิกของหลายชิ้นพร้อมกัน (Withdraw Cart) =====================

  // เข้าโหมดเบิกของหลายชิ้น ถ้าเริ่มจากไอเทมใดไอเทมหนึ่ง จะตั้งจำนวนเริ่มต้นให้ 1 ชิ้นทันที
  const startWithdrawMode = (item?: InventoryItem) => {
    setIsWithdrawMode(true);
    setWithdrawCartNote("");
    setIslandAlert(null);
    if (item && item.quantity > 0) {
      setWithdrawCart({ [item.id]: 1 });
    } else {
      setWithdrawCart({});
    }
  };

  const cancelWithdrawMode = () => {
    setIsWithdrawMode(false);
    setWithdrawCart({});
    setWithdrawCartNote("");
    setIsWithdrawCartSheetOpen(false);
  };

  // ปรับจำนวนที่จะเบิกของไอเทมหนึ่งชิ้น (ไม่ต่ำกว่า 0 ไม่เกินจำนวนคงเหลือ)
  const adjustCartQuantity = (item: InventoryItem, delta: number) => {
    setWithdrawCart((prev) => {
      const current = prev[item.id] || 0;
      const next = Math.min(Math.max(current + delta, 0), item.quantity);
      const updated = { ...prev };
      if (next <= 0) {
        delete updated[item.id];
      } else {
        updated[item.id] = next;
      }
      return updated;
    });
  };

  // ตั้งจำนวนที่จะเบิกโดยตรงจากช่องพิมพ์ (รองรับพิมพ์เลขเอง ไม่ใช่แค่กด +/-)
  // คีย์ค่าที่ไม่ใช่ตัวเลข/ว่างจะถูกตัดเป็น 0 ป้องกัน state ค้างเป็น NaN
  const setCartQuantityDirect = (item: InventoryItem, rawValue: string) => {
    const digitsOnly = rawValue.replace(/[^0-9]/g, "");
    const parsed = digitsOnly === "" ? 0 : Number(digitsOnly);
    const clamped = Math.min(Math.max(parsed, 0), item.quantity);
    setWithdrawCart((prev) => {
      const updated = { ...prev };
      if (clamped <= 0) {
        delete updated[item.id];
      } else {
        updated[item.id] = clamped;
      }
      return updated;
    });
  };

  // รายการไอเทมที่ถูกเลือกไว้ในตะกร้าเบิกของ (กรองเฉพาะที่จำนวน > 0 และยังมีอยู่จริงในตู้แก๊ง)
  const withdrawCartEntries = Object.entries(withdrawCart)
    .map(([itemId, qty]) => {
      const item = inventoryItems.find((invItem) => invItem.id === itemId);
      return item ? { item, qty } : null;
    })
    .filter((entry): entry is { item: InventoryItem; qty: number } => !!entry && entry.qty > 0);

  const withdrawCartItemCount = withdrawCartEntries.length;
  const withdrawCartTotalUnits = withdrawCartEntries.reduce((sum, entry) => sum + entry.qty, 0);

  const openWithdrawCartSheet = () => {
    if (withdrawCartEntries.length === 0) {
      showIslandAlert("❌ กรุณาเลือกจำนวนไอเทมที่จะเบิกก่อน");
      return;
    }
    setIsWithdrawCartSheetOpen(true);
  };

  // ยืนยันเบิกของทั้งตะกร้าในทีเดียว: ตัดสต๊อกทุกไอเทมพร้อมกันใน transaction เดียว
  // แล้วบันทึกเป็น log สรุปยอดเดียว (type: "withdrawBatch") แทนที่จะแยกเป็นหลายรายการ
  const submitWithdrawCart = async () => {
    if (!member) return showIslandAlert("กรุณาเข้าสู่ระบบ");
    if (withdrawCartEntries.length === 0) return;

    const cartEntries = withdrawCartEntries;
    setSubmittingWithdrawCart(true);
    try {
      const createdAt = new Date().toISOString();
      const note = withdrawCartNote.trim();
      const logRef = doc(collection(db, "gangInventoryLogs"));

      await runTransaction(db, async (transaction) => {
        const itemRefs = cartEntries.map((entry) => doc(db, "gangInventory", entry.item.id));
        // ต้องอ่านให้ครบทุกไอเทมก่อน แล้วค่อย write (ข้อจำกัดของ Firestore transaction)
        const itemSnapshots = await Promise.all(itemRefs.map((ref) => transaction.get(ref)));

        const resolvedItems = itemSnapshots.map((snapshot, index) => {
          const entry = cartEntries[index];
          if (!snapshot.exists()) {
            throw new Error(`ไม่พบไอเทม "${entry.item.name}" แล้ว`);
          }
          const data = snapshot.data() as Omit<InventoryItem, "id">;
          const currentQuantity = Number(data.quantity || 0);
          if (currentQuantity < entry.qty) {
            throw new Error(`"${data.name}" คงเหลือไม่พอเบิก`);
          }
          return {
            ref: itemRefs[index],
            itemId: entry.item.id,
            itemName: data.name,
            amount: entry.qty,
            nextQuantity: currentQuantity - entry.qty,
          };
        });

        resolvedItems.forEach((resolved) => {
          transaction.update(resolved.ref, { quantity: resolved.nextQuantity, updatedAt: createdAt });
        });

        transaction.set(logRef, {
          itemId: "",
          itemName: `เบิกของ ${resolvedItems.length} รายการ`,
          type: "withdrawBatch" as const,
          amount: resolvedItems.reduce((sum, resolved) => sum + resolved.amount, 0),
          remainingQuantity: 0,
          items: resolvedItems.map((resolved) => ({
            itemId: resolved.itemId,
            itemName: resolved.itemName,
            amount: resolved.amount,
          })),
          username: member.username,
          firstName: member.firstName,
          lastName: member.lastName,
          note,
          createdAt,
        });
      });

      const summaryText = cartEntries.map((entry) => `${entry.item.name} x${entry.qty}`).join(", ");
      showIslandAlert(`✅ เบิกของแล้ว: ${summaryText}`);
      cancelWithdrawMode();
    } catch (error) {
      console.error(error);
      showIslandAlert(error instanceof Error ? `❌ ${error.message}` : "❌ เบิกของไม่สำเร็จ");
    } finally {
      setSubmittingWithdrawCart(false);
    }
  };

  const openLeaveLog = () => {
    setLeaveLogPin("");
    setIsLeaveLogPinOpen(true);
    setIslandAlert(null);
  };

  const submitLeaveRequest = async () => {
    if (!member) return showIslandAlert("กรุณาเข้าสู่ระบบ");
    if (!leaveReason.trim()) return showIslandAlert("กรุณากรอกเหตุผลที่ลา");
    if (!leaveStartDate || !leaveEndDate) return showIslandAlert("กรุณาเลือกวันที่ลา");

    const leaveDays = getLeaveDays(leaveStartDate, leaveEndDate);
    if (leaveDays <= 0) return showIslandAlert("วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มลา");

    setSubmitting(true);
    try {
      await addDoc(collection(db, "gangLeaves"), {
        reason: leaveReason.trim(),
        startDate: leaveStartDate,
        endDate: leaveEndDate,
        leaveDays,
        username: member.username,
        firstName: member.firstName,
        lastName: member.lastName,
        createdAt: new Date().toISOString(),
      });
      setLeaveReason("");
      setLeaveStartDate("");
      setLeaveEndDate("");
      await loadLeaveLogs();
      showIslandAlert("✅ ส่งเรื่องลาเรียบร้อยแล้ว");
      setScreen("home");
    } catch (error) {
      console.error(error);
      showIslandAlert("❌ ส่งเรื่องลาไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };

  const verifyLeaveLogPin = async () => {
    if (!/^\d{6}$/.test(leaveLogPin)) {
      showIslandAlert("กรุณากรอกรหัส 6 หลัก");
      return;
    }

    setCheckingLeaveLogPin(true);
    try {
      const response = await fetch("/api/leave-log/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: leaveLogPin }),
      });
      const result = await response.json() as { valid?: boolean };
      if (!response.ok || !result.valid) {
        showIslandAlert("❌ รหัสไม่ถูกต้อง");
        setLeaveLogPin("");
        return;
      }
      setIsLeaveLogPinOpen(false);
      setLeaveLogPin("");
      await loadLeaveLogs();
      setScreen("leaveLog");
    } catch (error) {
      console.error(error);
      showIslandAlert("❌ ไม่สามารถตรวจสอบรหัสได้");
    } finally {
      setCheckingLeaveLogPin(false);
    }
  };

  const requestBackOfficeAccess = () => {
    setBackOfficePin("");
    setIsBackOfficePinOpen(true);
    setIslandAlert(null);
  };

  const verifyBackOfficePin = async () => {
    if (!/^\d{6}$/.test(backOfficePin)) {
      showIslandAlert("กรุณากรอกรหัส 6 หลัก");
      return;
    }

    setCheckingBackOfficePin(true);
    try {
      const response = await fetch("/api/backoffice/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: backOfficePin }),
      });

      const result = await response.json() as { valid?: boolean };
      if (!response.ok || !result.valid) {
        showIslandAlert("❌ รหัสไม่ถูกต้อง");
        setBackOfficePin("");
        return;
      }

      setIsBackOfficePinOpen(false);
      setBackOfficePin("");
      setScreen("backoffice");
    } catch (error) {
      console.error(error);
      showIslandAlert("❌ ไม่สามารถตรวจสอบรหัสได้");
    } finally {
      setCheckingBackOfficePin(false);
    }
  };

  const requestWalletAccess = () => {
    setWalletPin("");
    setIsWalletPinOpen(true);
    setIslandAlert(null);
  };

  const verifyWalletPin = async () => {
    if (!/^\d{6}$/.test(walletPin)) {
      showIslandAlert("กรุณากรอกรหัส 6 หลัก");
      return;
    }

    setCheckingWalletPin(true);
    try {
      const response = await fetch("/api/wallet/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: walletPin }),
      });
      const result = await response.json() as { valid?: boolean };

      if (!response.ok || !result.valid) {
        showIslandAlert("❌ รหัสไม่ถูกต้อง");
        setWalletPin("");
        return;
      }

      setIsWalletPinOpen(false);
      setWalletPin("");
      setScreen("bank");
    } catch (error) {
      console.error(error);
      showIslandAlert("❌ ไม่สามารถตรวจสอบรหัสได้");
    } finally {
      setCheckingWalletPin(false);
    }
  };

  const getDisplayName = (log: { firstName?: string, lastName?: string, username: string }) => {
    const generatedName = [log.firstName, log.lastName].filter(Boolean).join(" ");
    return generatedName || log.username || "Unknown User";
  };

  const getFundSenderName = (fund: Pick<GangFundLog, "firstName" | "lastName">) =>
    [fund.firstName, fund.lastName].filter(Boolean).join(" ") || "ไม่พบชื่อผู้ส่ง";

  const getMemberPhotoUrl = (username?: string) => (username ? memberDirectory[username]?.photoUrl : "") || "";

  const handleSubmit = async () => {
    if (!member) {
      showIslandAlert("กรุณาเข้าสู่ระบบ");
      return;
    }
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      showIslandAlert("กรุณากรอกจำนวนเงิน");
      return;
    }
    const isWithdraw = selectedTab === "withdraw";
    if (isWithdraw && Number(totalBalance) < amount) {
      showIslandAlert("❌ ยอดเงินไม่พอ");
      return;
    }

    setSubmitting(true);
    try {
      const reason = (form.message || "ไม่ระบุเหตุผล").trim();
      const bankRef = doc(db, "gangBank", "summary");
      const transactionLogRef = doc(collection(db, "gangTransactions"));
      const createdAt = new Date().toISOString();
      let nextGangBankBalance = gangBankBalance;

      // ทุกธุรกรรม (ฝาก/ถอน) ของทุกคน แก้ไขที่ยอดกองกลางเดียวกัน (gangBank/summary)
      // ไม่มีการแยกยอดเป็นรายบุคคลอีกต่อไป เพื่อให้ทุก user เห็นยอดตรงกันแบบเรียลไทม์
      await runTransaction(db, async (transaction) => {
        const bankSnapshot = await transaction.get(bankRef);
        const currentGangBankBalance = Number(bankSnapshot.data()?.total || 0);

        if (isWithdraw && currentGangBankBalance < amount) {
          throw new Error("ยอดเงินไม่พอ");
        }

        nextGangBankBalance = isWithdraw
          ? currentGangBankBalance - amount
          : currentGangBankBalance + amount;

        transaction.set(bankRef, { total: nextGangBankBalance, updatedAt: createdAt }, { merge: true });
        transaction.set(transactionLogRef, {
          username: member.username,
          firstName: member.firstName,
          lastName: member.lastName,
          type: selectedTab,
          amount,
          message: reason,
          createdAt,
          balanceAfter: nextGangBankBalance,
        });
      });

      setGangBankBalance(nextGangBankBalance);
      setForm(initialForm);
      setIsReasonSheetOpen(false);

      showIslandAlert(`✅ ${isWithdraw ? 'ถอน' : 'ฝาก'} ${amount.toLocaleString()} ฿`);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error && error.message === "ยอดเงินไม่พอ" ? "❌ ยอดเงินไม่พอ" : "❌ เกิดข้อผิดพลาด";
      showIslandAlert(message);
    } finally {
      setSubmitting(false);
    }
  };

  // จัดการอัพโหลดสลิปเงินแก๊ง
  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.type.startsWith("image/")) {
        showIslandAlert("❌ กรุณาเลือกไฟล์รูปภาพ");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        showIslandAlert("❌ รูปใหญ่เกิน 10 MB");
        return;
      }
      // เคลียร์ object URL ของรูปก่อนหน้า ป้องกัน memory leak เวลาผู้ใช้เลือกรูปใหม่ซ้ำๆ
      setFundImagePreview((prevUrl) => {
        if (prevUrl) URL.revokeObjectURL(prevUrl);
        return URL.createObjectURL(file);
      });
      setFundImage(file);
    }
  };

  // เคลียร์ object URL ตอน component unmount กันหลุด
  // (ของเดิม useEffect deps [] ทำให้ closure จำค่า fundImagePreview ตอน mount ซึ่งเป็น null เสมอ
  //  เลย revoke ไม่โดนของจริงเลยสักครั้ง จึงต้องใช้ ref เก็บค่าล่าสุดแทน)
  const fundImagePreviewRef = useRef<string | null>(null);
  useEffect(() => {
    fundImagePreviewRef.current = fundImagePreview;
  }, [fundImagePreview]);

  useEffect(() => {
    return () => {
      if (fundImagePreviewRef.current) URL.revokeObjectURL(fundImagePreviewRef.current);
    };
  }, []);

  const handleSendGangFund = async () => {
    if (!member) return showIslandAlert("กรุณาเข้าสู่ระบบ");
    if (!fundAmount || Number(fundAmount) <= 0) return showIslandAlert("❌ ใส่จำนวนเงิน");
    if (!fundImage) return showIslandAlert("❌ กรุณาแนบรูปสลิป");

    setSubmitting(true);
    try {
      // บีบอัดเป็น JPEG ก่อนเก็บใน Firestore เพื่อไม่ต้องยิงคำขอไป Storage จาก browser
      const imageUrl = await compressImageForFirestore(fundImage);

      const payload = {
        amount: Number(fundAmount),
        imageUrl: imageUrl,
        username: member.username,
        firstName: member.firstName,
        lastName: member.lastName,
        createdAt: new Date().toISOString(),
        status: "pending" as const,
      };
      await addDoc(collection(db, "gangFunds"), payload);
      await updateDoc(doc(db, "members", member.id), { gangFundStatus: "pending" });
      
      showIslandAlert("✅ ส่งเงินเข้าแก๊งสำเร็จ");
      setFundAmount("");
      setFundImage(null);
      if (fundImagePreview) URL.revokeObjectURL(fundImagePreview);
      setFundImagePreview(null);
      
      // อัปเดตข้อมูลหน้าหลังบ้าน
      await loadFundLogs();
      setScreen("home");

    } catch (error) {
      console.error(error);
      showIslandAlert(error instanceof Error ? `❌ ${error.message}` : "❌ บันทึกรูปล้มเหลว");
    } finally {
      setSubmitting(false);
    }
  };

  const approveGangFund = async (fund: GangFundLog) => {
    if (fund.status === "approved") return;

    setApprovingFundId(fund.id);
    try {
      const fundRef = doc(db, "gangFunds", fund.id);
      const bankRef = doc(db, "gangBank", "summary");
      const transactionLogRef = doc(collection(db, "gangTransactions"));
      const approvedAt = new Date().toISOString();

      await runTransaction(db, async (transaction) => {
        const fundSnapshot = await transaction.get(fundRef);
        if (!fundSnapshot.exists()) throw new Error("ไม่พบรายการนี้แล้ว");

        const fundData = fundSnapshot.data() as Omit<GangFundLog, "id">;
        if (fundData.status === "approved") return;

        const bankSnapshot = await transaction.get(bankRef);
        const currentTotal = Number(bankSnapshot.data()?.total || 0);
        const senderName = getFundSenderName(fundData);

        transaction.set(bankRef, { total: currentTotal + Number(fundData.amount), updatedAt: approvedAt }, { merge: true });
        transaction.update(fundRef, { status: "approved", approvedAt, gangTransactionId: transactionLogRef.id });
        transaction.set(transactionLogRef, {
          type: "deposit",
          amount: Number(fundData.amount),
          message: `เงินกองกลางจาก ${senderName}`,
          username: fundData.username,
          firstName: fundData.firstName || "",
          lastName: fundData.lastName || "",
          source: "gangFund",
          gangFundId: fund.id,
          createdAt: approvedAt,
        });
      });

      const senderSnapshot = await getDocs(query(collection(db, "members"), where("username", "==", fund.username)));
      const senderMember = senderSnapshot.docs[0];
      if (senderMember) {
        await updateDoc(senderMember.ref, { gangFundStatus: "approved" });
      }

      showIslandAlert("✅ อนุมัติเงินและเพิ่มยอด Bank แล้ว");
      await Promise.all([
        loadFundLogs(),
        loadGangBank(),
      ]);
    } catch (error) {
      console.error(error);
      showIslandAlert("❌ อนุมัติรายการไม่สำเร็จ");
    } finally {
      setApprovingFundId(null);
    }
  };

  const deleteGangFund = async (fund: GangFundLog) => {
    if (!window.confirm("ต้องการลบประวัติรายการนี้ใช่หรือไม่?")) return;

    setDeletingFundId(fund.id);
    try {
      const fundRef = doc(db, "gangFunds", fund.id);

      await runTransaction(db, async (transaction) => {
        const fundSnapshot = await transaction.get(fundRef);
        if (!fundSnapshot.exists()) throw new Error("ไม่พบรายการนี้แล้ว");

        // ลบเฉพาะประวัติที่แสดงใน Back Office ไม่ย้อนยอดหรือแตะ log ธุรกรรม
        transaction.delete(fundRef);
      });

      showIslandAlert("✅ ลบประวัติเรียบร้อยแล้ว");
      await loadFundLogs();
    } catch (error) {
      console.error(error);
      showIslandAlert("❌ ลบประวัติไม่สำเร็จ");
    } finally {
      setDeletingFundId(null);
    }
  };

  const resetGangFundRound = async () => {
    if (!window.confirm("รีเซ็ตการส่งเงินแก๊งทั้งหมดใช่หรือไม่? ประวัติส่งเงินจะถูกลบ และสถานะทุกคนจะกลับเป็นยังไม่ได้ส่ง")) return;
    if (!window.confirm("ยืนยันอีกครั้ง: ยอด Bank และ log Wallet จะยังอยู่ แต่ประวัติส่งเงินรอบนี้จะถูกลบถาวร")) return;

    setResettingFundRound(true);
    try {
      const [fundSnapshot, memberSnapshot] = await Promise.all([
        getDocs(collection(db, "gangFunds")),
        getDocs(collection(db, "members")),
      ]);

      const operations = [
        ...fundSnapshot.docs.map((fundDoc) => ({ type: "delete" as const, ref: fundDoc.ref })),
        ...memberSnapshot.docs.map((memberDoc) => ({ type: "reset" as const, ref: memberDoc.ref })),
      ];

      for (let start = 0; start < operations.length; start += 450) {
        const batch = writeBatch(db);
        operations.slice(start, start + 450).forEach((operation) => {
          if (operation.type === "delete") batch.delete(operation.ref);
          else batch.update(operation.ref, { gangFundStatus: "notSent" });
        });
        await batch.commit();
      }

      showIslandAlert("✅ เริ่มรอบส่งเงินใหม่แล้ว");
    } catch (error) {
      console.error(error);
      showIslandAlert("❌ รีเซ็ตรอบส่งเงินไม่สำเร็จ");
    } finally {
      setResettingFundRound(false);
    }
  };

  const pressCalculatorKey = (key: string) => {
    // กด Error แล้วต้องเริ่มใหม่เสมอ ไม่ว่าจะกดปุ่มไหน (ยกเว้น AC ที่เคลียร์อยู่แล้ว)
    if (calcDisplay === "Error" && key !== "AC") {
      setCalcDisplay("0");
      setCalcValue(null);
      setCalcOperator(null);
      setCalcWaiting(false);
    }

    if (/[0-9]/.test(key)) {
      setCalcDisplay((prev) => (prev === "0" || prev === "Error" || calcWaiting ? key : prev + key));
      setCalcWaiting(false);
      return;
    }
    if (key === ".") {
      if (calcWaiting) { setCalcDisplay("0."); setCalcWaiting(false); return; }
      if (!calcDisplay.includes(".")) setCalcDisplay((prev) => (prev === "0" ? "0." : prev + "."));
      return;
    }
    if (key === "AC") { setCalcDisplay("0"); setCalcValue(null); setCalcOperator(null); setCalcWaiting(false); return; }
    if (key === "±") { setCalcDisplay((prev) => String(Number(prev) * -1)); return; }
    if (key === "%") { setCalcDisplay((prev) => String(Number(prev) / 100)); return; }

    if (key === "=" || ["+", "−", "×", "÷"].includes(key)) {
      // บั๊กเดิม: ถ้ากดสลับเครื่องหมาย (เช่น + แล้วกด × ทันที) โค้ดเก่าจะคำนวณซ้ำด้วยค่าเดิม
      // ทำให้ตัวเลขเพี้ยน — ของจริงบน iOS แค่ "เปลี่ยนเครื่องหมาย" เฉยๆ ไม่คำนวณซ้ำ
      if (calcWaiting && key !== "=") {
        setCalcOperator(key);
        return;
      }

      const currentValue = Number(calcDisplay);
      let nextValue = currentValue;

      if (calcValue !== null && calcOperator) {
        let result = calcValue;
        switch (calcOperator) {
          case "+": result += currentValue; break;
          case "−": result -= currentValue; break;
          case "×": result *= currentValue; break;
          case "÷": result = currentValue === 0 ? NaN : result / currentValue; break;
        }

        // กันหาร 0 / ผลลัพธ์ที่ไม่ใช่ตัวเลข ไม่ให้ค้างเป็น "Infinity" หรือ "NaN" บนจอ
        if (!Number.isFinite(result)) {
          setCalcDisplay("Error");
          setCalcValue(null);
          setCalcOperator(null);
          setCalcWaiting(false);
          return;
        }

        setCalcDisplay(String(result));
        nextValue = result;
      }

      setCalcValue(nextValue);
      if (key === "=") { setCalcOperator(null); setCalcWaiting(false); }
      else { setCalcOperator(key); setCalcWaiting(true); }
    }
  };

  if (loading) return <div className={styles.loadingScreen}>Loading OS...</div>;

  return (
    <AuthGuard>
      <main className={styles.page}>
      <div className={styles.deviceShell}>
        
        {/* Dynamic Island */}
        <div className={`${styles.dynamicIsland} ${islandAlert ? styles.islandExpanded : ''}`}>
          {islandAlert ? (
            <span className={styles.islandMessage}>{islandAlert}</span>
          ) : (
            <>
              <div className={styles.islandCam} />
              <div className={styles.islandCam} style={{ width: '8px', height: '8px' }} />
            </>
          )}
        </div>

        <div className={styles.screen}>
          <div className={styles.wallpaper} style={{ backgroundImage: `url(${wallpaper.src})` }} />

          <div className={`${styles.lockScreen} ${!isLocked ? styles.unlocked : ''}`} onClick={() => setIsLocked(false)}>
            <div className={styles.lockIcon}>🔒</div>
            <div className={styles.lockTime}>{formattedTime}</div>
            <div className={styles.lockDate}>{formattedDate}</div>
            <div className={styles.swipeText}>Tap to open</div>
            <div className={styles.lockQuickActions}>
              <div className={styles.lockQuickIcon} onClick={(e) => e.stopPropagation()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a6 6 0 0 0-4 10.5c.7.6 1 1.2 1 2.5h6c0-1.3.3-1.9 1-2.5A6 6 0 0 0 12 2Z" /></svg>
              </div>
              <div className={styles.lockQuickIcon} onClick={(e) => e.stopPropagation()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" /><circle cx="12" cy="13" r="4" /></svg>
              </div>
            </div>
          </div>

          <div className={styles.statusBar}>
            <span>{formattedTime}</span>
            <div className={styles.statusIcons}>
              <svg width="18" height="12" viewBox="0 0 18 12" fill="white" aria-hidden="true">
                <rect x="0" y="7" width="3" height="5" rx="0.5" />
                <rect x="5" y="5" width="3" height="7" rx="0.5" />
                <rect x="10" y="3" width="3" height="9" rx="0.5" />
                <rect x="15" y="0" width="3" height="12" rx="0.5" />
              </svg>
              <span>5G</span>
              <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="white" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
                <path d="M1 4.2C4.9-0.2 11.1-0.2 15 4.2" />
                <path d="M3.4 6.9C5.9 4.1 10.1 4.1 12.6 6.9" />
                <path d="M6 9.6C7.1 8.3 8.9 8.3 10 9.6" />
              </svg>
              <span>100%</span>
              <svg width="24" height="12" viewBox="0 0 24 12" fill="white"><path d="M21 4V8C21 8.55228 21.4477 9 22 9H23C23.5523 9 24 8.55228 24 8V4C24 3.44772 23.5523 3 23 3H22C21.4477 3 21 3.44772 21 4Z"/><rect x="1" y="1" width="19" height="10" rx="3" stroke="white" strokeWidth="1"/><rect x="3" y="3" width="15" height="6" rx="1"/></svg>
            </div>
          </div>

          {/* HOME SCREEN */}
          <div className={styles.homeScreen}>
            <div className={styles.appGrid}>
              <button type="button" className={styles.appIcon} onClick={requestWalletAccess}>
                <div className={`${styles.appBadge} ${styles.svgIconBgPurple}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 21h18"></path>
                    <path d="M3 10h18"></path>
                    <path d="M5 6l7-3 7 3"></path>
                    <path d="M4 10v11"></path>
                    <path d="M20 10v11"></path>
                    <path d="M8 14v3"></path>
                    <path d="M12 14v3"></path>
                    <path d="M16 14v3"></path>
                  </svg>
                </div>
                <span>Wallet</span>
              </button>

              <button type="button" className={styles.appIcon} onClick={openMessages}>
                <div className={`${styles.appBadge} ${styles.svgIconBgMessage}`}>
                  <svg viewBox="0 0 24 24" fill="white" stroke="none">
                    <path d="M12 2C6.477 2 2 6.14 2 11.25c0 2.87 1.487 5.43 3.824 7.12-.245 1.76-1.127 3.25-1.168 3.32a.75.75 0 0 0 .848 1.1c3.15-.9 5.035-2.4 5.955-3.32a10.42 10.42 0 0 0 1.541.13c5.523 0 10-4.14 10-9.25S17.523 2 12 2zm-3 10a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
                  </svg>
                </div>
                {unreadMessageCount > 0 && (
                  <span className={styles.unreadBadge} aria-label={`${unreadMessageCount} unread messages`}>
                    {unreadMessageCount > 99 ? "99+" : unreadMessageCount}
                  </span>
                )}
                <span>Messages</span>
              </button>

              <button type="button" className={styles.appIcon} onClick={() => setScreen("calculator")}>
                <div className={`${styles.appBadge} ${styles.svgIconBgCalc}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
                    <line x1="8" y1="6" x2="16" y2="6" />
                    <line x1="8" y1="10" x2="8" y2="10.01" strokeWidth="3" />
                    <line x1="12" y1="10" x2="12" y2="10.01" strokeWidth="3" />
                    <line x1="16" y1="10" x2="16" y2="10.01" strokeWidth="3" />
                    <line x1="8" y1="14" x2="8" y2="14.01" strokeWidth="3" />
                    <line x1="12" y1="14" x2="12" y2="14.01" strokeWidth="3" />
                    <line x1="16" y1="14" x2="16" y2="14.01" strokeWidth="3" />
                    <line x1="8" y1="18" x2="8" y2="18.01" strokeWidth="3" />
                    <line x1="12" y1="18" x2="12" y2="18.01" strokeWidth="3" />
                    <line x1="16" y1="18" x2="16" y2="18.01" strokeWidth="3" />
                  </svg>
                </div>
                <span>Calculator</span>
              </button>

              {/* ไอคอน ส่งเงินแก๊ง (สร้างด้วย CSS+SVG) */}
              <button type="button" className={styles.appIcon} onClick={() => setScreen("sendMoney")}>
                <div className={`${styles.appBadge} ${styles.svgIconBgGreen}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                </div>
                <span>Send Money</span>
              </button>

              {/* ไอคอน หลังบ้าน (สร้างด้วย CSS+SVG) */}
              <button type="button" className={styles.appIcon} onClick={requestBackOfficeAccess}>
                <div className={`${styles.appBadge} ${styles.svgIconBgDark}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                </div>
                <span>Back Office</span>
              </button>

              <button type="button" className={styles.appIcon} onClick={() => setScreen("leave")}>
                <div className={`${styles.appBadge} ${styles.svgIconBgLeave}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 3v18M18 3v18M6 5h9a3 3 0 0 1 0 6H6m0 0h10a3 3 0 0 1 0 6H6" />
                  </svg>
                </div>
                <span>ลาแก๊ง</span>
              </button>

              <button type="button" className={styles.appIcon} onClick={openLeaveLog}>
                <div className={`${styles.appBadge} ${styles.svgIconBgLeaveLog}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h5" />
                  </svg>
                </div>
                <span>Log ลา</span>
              </button>

              <button type="button" className={styles.appIcon} onClick={openInventory}>
                <div className={`${styles.appBadge} ${styles.svgIconBgLocker}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="2" width="16" height="20" rx="2" />
                    <line x1="12" y1="2" x2="12" y2="22" />
                    <circle cx="9.3" cy="12" r="0.9" fill="white" stroke="none" />
                    <circle cx="14.7" cy="12" r="0.9" fill="white" stroke="none" />
                  </svg>
                </div>
                {inventoryItems.some((item) => item.quantity <= 0) && (
                  <span className={styles.unreadBadge} aria-label="มีไอเทมหมดสต๊อก">!</span>
                )}
                <span>ตู้แก๊ง</span>
              </button>

              <button type="button" className={styles.appIcon} onClick={openSettings}>
                <div className={`${styles.appBadge} ${styles.svgIconBgSettings}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                    <path d="m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4v.3a2 2 0 1 1-4 0v-.2a2 2 0 0 0-3.4-1.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A2 2 0 0 0 3.7 12a2 2 0 0 0-1.7-2 2 2 0 1 1 0-4h.2a2 2 0 0 0 1.4-3.4l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A2 2 0 0 0 9.8 1.4h.2a2 2 0 1 1 4 0v.2a2 2 0 0 0 3.4 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A2 2 0 0 0 21.6 9h.2a2 2 0 1 1 0 4h-.2a2 2 0 0 0-2.2 2Z" transform="translate(-1.8 -1.8) scale(1.15)" />
                  </svg>
                </div>
                <span>ตั้งค่า</span>
              </button>
            </div>
          </div>

          {/* APP SCREENS */}
          {screen === "bank" && (
             // โค้ดส่วน Bank เดิม
            <div className={styles.appContainer}>
              <div className={styles.glassHeader}>
                <button type="button" className={styles.backButton} onClick={() => setScreen("home")}><span>‹</span> Back</button>
                <div className={styles.titleWrap}>Gang Wallet</div>
                <div style={{width: '50px'}}></div>
              </div>
              <div className={styles.appContent} style={{ paddingTop: '100px' }}>
                <div className={styles.appleWalletCard}>
                  <div className={styles.balanceMeta}>Total Balance • THB</div>
                  <div className={styles.balanceAmount}>฿ {totalBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                </div>

                <div className={styles.quickActions}>
                  <button type="button" className={styles.actionButton} onClick={() => openTransactionSheet("deposit")}>
                    <span>⊕</span> ฝากเงิน
                  </button>
                  <button type="button" className={styles.actionButton} onClick={() => openTransactionSheet("withdraw")}>
                    <span>⊖</span> ถอนเงิน
                  </button>
                </div>

                <div className={styles.transactionCard}>
                  <div className={styles.cardHeader}><span>Latest Transactions</span></div>
                  {logs.slice(0, 5).map((log) => (
                    <div key={log.id} className={styles.logRow}>
                      <div className={styles.logInfo}>
                        <div className={`${styles.iconCircle} ${log.type === "deposit" ? styles.depositIcon : styles.withdrawIcon}`}>
                          {log.type === "deposit" ? '↓' : '↑'}
                        </div>
                        <div className={styles.logText}>
                          <strong>{getDisplayName(log)}</strong>
                          <small>{log.type === "deposit" ? "Deposit" : "Withdraw"} • {log.message || "No remark"}</small>
                        </div>
                      </div>
                      <strong style={{ color: log.type === "deposit" ? '#32d74b' : 'white' }}>
                        {log.type === "deposit" ? "+" : "-"}{log.amount.toLocaleString()} ฿
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* APP: Send Money (ดีไซน์ใหม่สไตล์ iOS) */}
          {screen === "sendMoney" && (
            <div className={styles.appContainer}>
              <div className={styles.glassHeader}>
                <button type="button" className={styles.backButton} onClick={() => setScreen("home")}>
                  <span>‹</span> Back
                </button>
                <div className={styles.titleWrap}>Send Gang Fund</div>
                <div style={{width: '50px'}}></div>
              </div>
              
              <div className={`${styles.appContent} ${styles.iosPagePadding}`}>
                <h2 className={styles.iosLargeTitle}>ส่งเงินกองกลาง</h2>
                
                {/* กล่องใส่จำนวนเงิน */}
                <div className={styles.iosFormGroup}>
                  <div className={styles.iosInputRow}>
                    <label>จำนวนเงิน</label>
                    <input
                      id="fundAmount"
                      name="fundAmount"
                      type="number" 
                      value={fundAmount} 
                      onChange={(e) => setFundAmount(e.target.value)} 
                      placeholder="0.00" 
                    />
                    <span className={styles.currencyTag}>THB</span>
                  </div>
                </div>

                <div className={styles.iosFormNote}>อัพโหลดรูปภาพสลิปโอนเงินเพื่อยืนยันรายการ</div>

                {/* กล่องอัพโหลดสลิป */}
                <div className={styles.iosFormGroup}>
                  <div className={styles.iosUploadRow}>
                    <input type="file" accept="image/*" onChange={handleImageChange} id="fileUpload" name="fundImage" hidden />
                    <label htmlFor="fileUpload" className={styles.iosUploadLabel}>
                      {fundImagePreview ? (
                        <img src={fundImagePreview} alt="Preview" className={styles.iosImagePreview} />
                      ) : (
                        <div className={styles.iosUploadPlaceholder}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                          <span>แตะเพื่อเลือกรูปสลิป</span>
                        </div>
                      )}
                    </label>
                  </div>
                </div>

                {/* ปุ่มกดส่ง */}
                <button type="button" className={styles.iosPrimaryBtn} onClick={handleSendGangFund} disabled={submitting}>
                  {submitting ? "กำลังอัพโหลด..." : "ส่งเงินเข้าแก๊ง"}
                </button>
              </div>
            </div>
          )}

          {screen === "leave" && (
            <div className={styles.appContainer}>
              <div className={styles.glassHeader}>
                <button type="button" className={styles.backButton} onClick={() => setScreen("home")}><span>‹</span> Back</button>
                <div className={styles.titleWrap}>ลาแก๊ง</div>
                <div style={{ width: "50px" }} />
              </div>
              <div className={`${styles.appContent} ${styles.iosPagePadding}`}>
                <h2 className={styles.iosLargeTitle}>ส่งเรื่องลา</h2>
                <div className={styles.leaveIntro}>กรอกเหตุผลและช่วงวันที่ต้องการลา</div>
                <div className={styles.iosFormGroup}>
                  <label className={styles.leaveField}>
                    <span>เหตุผลที่ลา</span>
                    <textarea id="leaveReason" name="leaveReason" rows={4} value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} placeholder="เช่น ลากิจส่วนตัว..." />
                  </label>
                  <label className={styles.leaveField}>
                    <span>ตั้งแต่วันที่</span>
                    <input id="leaveStartDate" name="leaveStartDate" type="date" value={leaveStartDate} onChange={(e) => setLeaveStartDate(e.target.value)} />
                  </label>
                  <label className={styles.leaveField}>
                    <span>ถึงวันที่</span>
                    <input id="leaveEndDate" name="leaveEndDate" type="date" min={leaveStartDate || undefined} value={leaveEndDate} onChange={(e) => setLeaveEndDate(e.target.value)} />
                  </label>
                </div>
                {leaveStartDate && leaveEndDate && getLeaveDays(leaveStartDate, leaveEndDate) > 0 && (
                  <div className={styles.leaveDaysPreview}>รวม {getLeaveDays(leaveStartDate, leaveEndDate)} วัน</div>
                )}
                <button type="button" className={styles.iosPrimaryBtn} onClick={submitLeaveRequest} disabled={submitting}>
                  {submitting ? "กำลังส่งเรื่อง..." : "ส่งเรื่องลา"}
                </button>
              </div>
            </div>
          )}

          {screen === "settings" && (
            <div className={styles.appContainer}>
              <div className={styles.glassHeader}>
                <button type="button" className={styles.backButton} onClick={() => setScreen("home")}><span>‹</span> Back</button>
                <div className={styles.titleWrap}>ตั้งค่า</div>
                <div style={{ width: "50px" }} />
              </div>
              <div className={`${styles.appContent} ${styles.iosPagePadding}`}>
                <h2 className={styles.iosLargeTitle}>แก้ไขโปรไฟล์</h2>
                <div className={styles.settingsProfilePreview}>
                  {settingsPhotoPreview ? (
                    <img src={settingsPhotoPreview} alt="รูปโปรไฟล์" className={styles.settingsProfileImage} />
                  ) : (
                    <div className={styles.settingsProfileInitials}>
                      {`${settingsFirstName[0] || ""}${settingsLastName[0] || ""}`.toUpperCase() || "DR"}
                    </div>
                  )}
                  <label htmlFor="profilePhoto" className={styles.settingsPhotoButton}>เลือกรูปโปรไฟล์</label>
                  <input id="profilePhoto" name="profilePhoto" type="file" accept="image/*" onChange={handleSettingsPhotoChange} hidden />
                </div>
                <div className={styles.iosFormGroup}>
                  <label className={styles.leaveField}>
                    <span>ชื่อ IC</span>
                    <input id="settingsFirstName" name="settingsFirstName" value={settingsFirstName} onChange={(e) => setSettingsFirstName(e.target.value)} />
                  </label>
                  <label className={styles.leaveField}>
                    <span>นามสกุล IC</span>
                    <input id="settingsLastName" name="settingsLastName" value={settingsLastName} onChange={(e) => setSettingsLastName(e.target.value)} />
                  </label>
                  <label className={styles.leaveField}>
                    <span>เบอร์โทรศัพท์</span>
                    <input id="settingsPhone" name="settingsPhone" type="tel" inputMode="tel" value={settingsPhone} onChange={(e) => setSettingsPhone(e.target.value)} />
                  </label>
                  <div className={styles.leaveField}>
                    <span>สถานะความสัมพันธ์</span>
                    <div className={styles.settingsStatusOptions}>
                      {(["โสด", "มีแฟน"] as const).map((status) => (
                        <button key={status} type="button" className={`${styles.settingsStatusButton} ${settingsRelationshipStatus === status ? styles.settingsStatusActive : ""}`} onClick={() => setSettingsRelationshipStatus(status)}>
                          {status}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <button type="button" className={styles.iosPrimaryBtn} onClick={saveSettings} disabled={submitting}>
                  {submitting ? "กำลังบันทึก..." : "บันทึกโปรไฟล์"}
                </button>
              </div>
            </div>
          )}

          {/* APP: ตู้แก๊ง (Inventory) */}
          {screen === "inventory" && (
            <div className={styles.appContainer}>
              <div className={styles.glassHeader}>
                <button type="button" className={styles.backButton} onClick={() => { cancelWithdrawMode(); setScreen("home"); }}>
                  <span>‹</span> Back
                </button>
                <div className={styles.titleWrap}>ตู้แก๊ง</div>
                <button type="button" className={styles.headerAddButton} onClick={openAddItemSheet} aria-label="เพิ่มไอเทมใหม่">
                  +
                </button>
              </div>

              <div className={`${styles.appContent} ${styles.iosPagePadding} ${styles.backOfficeContent}`}>
                <h2 className={styles.iosLargeTitle}>คลังไอเทมแก๊ง</h2>

                <div className={styles.inventorySearchGroup}>
                  <input
                    id="inventorySearch"
                    name="inventorySearch"
                    className={styles.inventorySearchInput}
                    value={inventorySearch}
                    onChange={(e) => setInventorySearch(e.target.value)}
                    placeholder="ค้นหาไอเทม..."
                  />
                </div>

                <div className={styles.inventoryModeRow}>
                  {!isWithdrawMode ? (
                    <button
                      type="button"
                      className={styles.inventoryWithdrawModeBtn}
                      onClick={() => startWithdrawMode()}
                      disabled={inventoryItems.every((item) => item.quantity <= 0)}
                    >
                      🧾 เบิกของหลายชิ้น
                    </button>
                  ) : (
                    <button type="button" className={styles.inventoryCancelModeBtn} onClick={cancelWithdrawMode}>
                      ✕ ยกเลิกการเบิก
                    </button>
                  )}
                </div>

                <div className={styles.iosFormGroup}>
                  <div className={styles.iosListHeader}>
                    <span>รายการไอเทมทั้งหมด</span>
                    <span className={styles.iosListCount}>{filteredInventoryItems.length} รายการ</span>
                  </div>
                  <div className={styles.iosListBody}>
                    {filteredInventoryItems.length === 0 && (
                      <div className={styles.iosEmptyState}>
                        {inventoryItems.length === 0 ? "ยังไม่มีไอเทมในตู้แก๊ง กดปุ่ม + เพื่อเพิ่มไอเทมแรก" : "ไม่พบไอเทมที่ค้นหา"}
                      </div>
                    )}
                    {filteredInventoryItems.map((item) => (
                      <div
                        key={item.id}
                        className={`${styles.inventoryItemCard} ${isWithdrawMode && (withdrawCart[item.id] || 0) > 0 ? styles.inventoryItemCardActive : ""}`}
                      >
                        <div className={styles.inventoryItemRow}>
                          <div className={styles.inventoryItemThumb}>
                            {item.imageUrl && !brokenItemImageIds.has(item.id) ? (
                              <img
                                src={item.imageUrl}
                                alt=""
                                onError={() =>
                                  setBrokenItemImageIds((prev) => {
                                    const next = new Set(prev);
                                    next.add(item.id);
                                    return next;
                                  })
                                }
                              />
                            ) : (
                              item.name.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div className={styles.inventoryItemInfo}>
                            <strong>{item.name}</strong>
                            <small className={item.quantity <= 0 ? styles.inventoryOut : item.quantity <= LOW_STOCK_THRESHOLD ? styles.inventoryLow : ""}>
                              {item.quantity <= 0 ? "ของหมด" : `คงเหลือ ${item.quantity.toLocaleString()} ชิ้น`}
                            </small>
                          </div>
                          {!isWithdrawMode && (
                            <button
                              type="button"
                              className={styles.inventoryDeleteBtn}
                              onClick={() => void deleteInventoryItem(item)}
                              disabled={deletingItemId === item.id}
                              aria-label={`ลบ ${item.name}`}
                            >
                              {deletingItemId === item.id ? "…" : "🗑"}
                            </button>
                          )}
                        </div>
                        {isWithdrawMode ? (
                          <div className={styles.inventoryCartStepper}>
                            <span className={styles.inventoryCartStepperLabel}>จำนวนที่จะเบิก</span>
                            <div className={styles.inventoryCartStepperControls}>
                              <button
                                type="button"
                                className={styles.inventoryCartStepBtn}
                                onClick={() => adjustCartQuantity(item, -1)}
                                disabled={(withdrawCart[item.id] || 0) <= 0}
                                aria-label={`ลดจำนวน ${item.name}`}
                              >
                                −
                              </button>
                              <input
                                id={`withdrawQuantity-${item.id}`}
                                name={`withdrawQuantity-${item.id}`}
                                type="text"
                                inputMode="numeric"
                                className={styles.inventoryCartQtyInput}
                                value={withdrawCart[item.id] || ""}
                                placeholder="0"
                                onChange={(e) => setCartQuantityDirect(item, e.target.value)}
                                onFocus={(e) => e.target.select()}
                                aria-label={`พิมพ์จำนวนที่จะเบิก ${item.name}`}
                              />
                              <button
                                type="button"
                                className={styles.inventoryCartStepBtn}
                                onClick={() => adjustCartQuantity(item, 1)}
                                disabled={(withdrawCart[item.id] || 0) >= item.quantity}
                                aria-label={`เพิ่มจำนวน ${item.name}`}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className={styles.inventoryActionsRow}>
                            <button type="button" className={styles.inventoryAddStockBtn} onClick={() => openStockSheet(item, "add")}>
                              + เพิ่มจำนวน
                            </button>
                            <button
                              type="button"
                              className={styles.inventoryWithdrawBtn}
                              onClick={() => startWithdrawMode(item)}
                              disabled={item.quantity <= 0}
                            >
                              เบิกของ
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className={styles.iosFormGroup}>
                  <div className={styles.iosListHeader}>
                    <span>ประวัติการเบิก/เติมของ</span>
                    <span className={styles.iosListCount}>{inventoryLogs.length} รายการ</span>
                  </div>
                  <div className={styles.iosListBody}>
                    {inventoryLogs.length === 0 && <div className={styles.iosEmptyState}>ยังไม่มีประวัติการใช้งานตู้แก๊ง</div>}
                    {inventoryLogs.map((log) => (
                      <div key={log.id} className={styles.iosListItem}>
                        <div className={styles.iosListRow}>
                          <div className={styles.iosListUser}>
                            <div className={styles.iosAvatar}>
                              {getMemberPhotoUrl(log.username) ? (
                                <img src={getMemberPhotoUrl(log.username)} alt="" className={styles.avatarPhoto} />
                              ) : (
                                getDisplayName(log).charAt(0)
                              )}
                            </div>
                            <div className={styles.iosUserInfo}>
                              <strong>{getDisplayName(log)}</strong>
                              <small>{new Date(log.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</small>
                            </div>
                          </div>
                          {log.type === "withdrawBatch" ? (
                            <span className={styles.inventoryLogWithdraw}>
                              −{log.amount.toLocaleString()} ชิ้น • {(log.items || []).length} รายการ
                            </span>
                          ) : (
                            <span className={log.type === "withdraw" ? styles.inventoryLogWithdraw : styles.inventoryLogAdd}>
                              {log.type === "withdraw" ? "−" : "+"}
                              {log.amount.toLocaleString()} • {log.itemName}
                            </span>
                          )}
                        </div>
                        {log.type === "withdrawBatch" && !!(log.items || []).length && (
                          <div className={styles.inventoryBatchList}>
                            {(log.items || []).map((entry, index) => (
                              <span key={`${entry.itemId}-${index}`}>
                                {entry.itemName} ×{entry.amount.toLocaleString()}
                                {index < (log.items || []).length - 1 ? ", " : ""}
                              </span>
                            ))}
                          </div>
                        )}
                        {log.note && <div className={styles.leaveReasonText}>{log.note}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {isWithdrawMode && (
                <div className={styles.withdrawCartBar}>
                  <div className={styles.withdrawCartBarInfo}>
                    <strong>{withdrawCartItemCount} ไอเทม</strong>
                    <span>{withdrawCartTotalUnits.toLocaleString()} ชิ้น</span>
                  </div>
                  <button
                    type="button"
                    className={styles.withdrawCartBarBtn}
                    onClick={openWithdrawCartSheet}
                    disabled={withdrawCartItemCount === 0}
                  >
                    ดูสรุป & ยืนยันเบิก
                  </button>
                </div>
              )}
            </div>
          )}

          {screen === "leaveLog" && (
            <div className={styles.appContainer}>
              <div className={styles.glassHeader}>
                <button type="button" className={styles.backButton} onClick={() => setScreen("home")}><span>‹</span> Back</button>
                <div className={styles.titleWrap}>Log ลา</div>
                <div style={{ width: "50px" }} />
              </div>
              <div className={`${styles.appContent} ${styles.iosPagePadding} ${styles.backOfficeContent}`}>
                <h2 className={styles.iosLargeTitle}>ประวัติการลา</h2>
                {leaveLogs.length === 0 ? (
                  <div className={styles.iosFormGroup}><div className={styles.iosEmptyState}>ยังไม่มีประวัติการลา</div></div>
                ) : (
                  leaveLogGroups.map((group) => (
                    <div key={group.dateKey} className={styles.leaveDayGroup}>
                      <div className={styles.leaveDayGroupHeader}>
                        {group.dateKey === todayBangkokKey ? "วันนี้ • " : ""}
                        {group.dateKey === "ไม่ทราบวันที่ยื่น" ? group.dateKey : formatBangkokDateLabel(group.dateKey)}
                      </div>
                      <div className={styles.leaveLogList}>
                        {group.items.map((leave) => {
                          // "ลาสะสม" นับจากประวัติทั้งหมดของคนนั้น ไม่ผูกกับหมวดวันที่ ตามที่ต้องการให้คงเดิม
                          const personLogs = leaveLogs.filter((item) => item.username === leave.username);
                          const totalLeaveDays = personLogs.reduce((total, item) => total + Number(item.leaveDays || 0), 0);
                          const status = getLeaveStatus(leave, todayBangkokKey);
                          const daysUntilStart = status === "upcoming" ? Math.max(0, getLeaveDays(todayBangkokKey, leave.startDate) - 1) : 0;
                          return (
                            <div
                              key={leave.id}
                              className={`${styles.leaveLogCard} ${status === "completed" ? styles.leaveLogCardCompleted : ""}`}
                            >
                              <div className={styles.iosListRow}>
                                <div className={styles.iosListUser}>
                                  <div className={styles.leaveAvatar}>
                                    {getMemberPhotoUrl(leave.username) ? (
                                      <img src={getMemberPhotoUrl(leave.username)} alt="" className={styles.avatarPhoto} />
                                    ) : (
                                      leave.firstName.charAt(0) || "?"
                                    )}
                                  </div>
                                  <div className={styles.iosUserInfo}>
                                    <strong>{[leave.firstName, leave.lastName].filter(Boolean).join(" ") || "ไม่พบชื่อผู้ลา"}</strong>
                                    <small>ลาสะสมแล้ว {totalLeaveDays} วัน</small>
                                  </div>
                                </div>
                                {/* เมื่อครบกำหนดวันลาแล้ว ตัวเลขจำนวนวันจะซ่อนไปตามที่ต้องการ */}
                                {status === "completed" ? null : status === "upcoming" ? (
                                  <span className={`${styles.leaveDuration} ${styles.leaveDurationUpcoming}`}>
                                    อีก {daysUntilStart} วัน
                                  </span>
                                ) : (
                                  <span className={styles.leaveDuration}>{leave.leaveDays} วัน</span>
                                )}
                              </div>
                              <div className={styles.leaveDateRange}>
                                {leave.startDate} ถึง {leave.endDate}
                                <span className={`${styles.leaveStatusPill} ${styles[`leaveStatus${status.charAt(0).toUpperCase()}${status.slice(1)}`]}`}>
                                  {LEAVE_STATUS_LABEL[status]}
                                </span>
                              </div>
                              <div className={styles.leaveReasonText}>{leave.reason}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* APP: Back Office (แก้บัค UI เพี้ยน และปรับให้คลีนขึ้น) */}
          {screen === "backoffice" && (
            <div className={styles.appContainer}>
              <div className={styles.glassHeader}>
                <button type="button" className={styles.backButton} onClick={() => setScreen("home")}>
                  <span>‹</span> Back
                </button>
                <div className={styles.titleWrap}>Back Office</div>
                <div style={{width: '50px'}}></div>
              </div>
              
              <div className={`${styles.appContent} ${styles.iosPagePadding} ${styles.backOfficeContent}`}>
                <h2 className={styles.iosLargeTitle}>ประวัติกองกลาง</h2>
                <button
                  type="button"
                  className={styles.resetFundRoundButton}
                  onClick={() => void resetGangFundRound()}
                  disabled={resettingFundRound}
                >
                  {resettingFundRound ? "กำลังเริ่มรอบใหม่..." : "Reset All รอบส่งเงิน"}
                </button>
                <div className={styles.iosFormGroup}>
                  <div className={styles.iosListHeader}>
                    <span>รายการทั้งหมด</span>
                    <span className={styles.iosListCount}>{fundLogs.length} รายการ</span>
                  </div>
                  
                  <div className={styles.iosListBody}>
                    {fundLogs.length === 0 && (
                      <div className={styles.iosEmptyState}>ยังไม่มีรายการส่งเงินกองกลาง</div>
                    )}
                    
                    {fundLogs.map((log) => (
                      <div key={log.id} className={styles.iosListItem}>
                        <div className={styles.iosListRow}>
                          <div className={styles.iosListUser}>
                            <div className={styles.iosAvatar}>
                            {getMemberPhotoUrl(log.username) ? (
                              <img src={getMemberPhotoUrl(log.username)} alt="" className={styles.avatarPhoto} />
                            ) : (
                              getFundSenderName(log).charAt(0)
                            )}
                          </div>
                            <div className={styles.iosUserInfo}>
                              <strong>{getFundSenderName(log)}</strong>
                              <small>{new Date(log.createdAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</small>
                            </div>
                          </div>
                          <span className={styles.iosListAmount}>+{log.amount.toLocaleString()} ฿</span>
                        </div>
                        {log.imageUrl && !brokenSlipIds.has(log.id) ? (
                          <a href={log.imageUrl} target="_blank" rel="noopener noreferrer" className={styles.iosSlipLink}>
                            <img
                              src={log.imageUrl}
                              alt="Slip"
                              className={styles.iosSlipThumb}
                              onError={() =>
                                setBrokenSlipIds((prev) => {
                                  const next = new Set(prev);
                                  next.add(log.id);
                                  return next;
                                })
                              }
                            />
                          </a>
                        ) : (
                          <div className={styles.iosSlipPlaceholder}>ไม่พบรูปภาพสลิป</div>
                        )}
                        <div className={styles.fundApprovalRow}>
                          <span className={log.status === "approved" ? styles.fundApproved : styles.fundPending}>
                            {log.status === "approved" ? "อนุมัติแล้ว" : "รอตรวจสอบ"}
                          </span>
                          {log.status !== "approved" && (
                            <button
                              type="button"
                              className={styles.approveFundButton}
                              onClick={() => void approveGangFund(log)}
                              disabled={approvingFundId === log.id}
                            >
                              {approvingFundId === log.id ? "กำลังบันทึก..." : "✓ อนุมัติเงิน"}
                            </button>
                          )}
                          <button
                            type="button"
                            className={styles.deleteFundButton}
                            onClick={() => void deleteGangFund(log)}
                            disabled={deletingFundId === log.id}
                          >
                            {deletingFundId === log.id ? "กำลังลบ..." : "ลบ"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {isBackOfficePinOpen && (
            <div className={styles.reasonOverlay} onClick={() => setIsBackOfficePinOpen(false)}>
              <div className={styles.reasonSheet} onClick={(e) => e.stopPropagation()}>
                <div className={styles.sheetDragLine} />
                <h3 style={{ color: "white", marginBottom: "20px", textAlign: "center" }}>
                  ยืนยันตัวตน Back Office
                </h3>
                <label className={styles.fieldLabel}>
                  <span>รหัสผ่าน 6 หลัก</span>
                  <input
                    id="backOfficePin"
                    name="backOfficePin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="current-password"
                    maxLength={6}
                    value={backOfficePin}
                    onChange={(e) => setBackOfficePin(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void verifyBackOfficePin();
                    }}
                    placeholder="••••••"
                    autoFocus
                  />
                </label>
                <button type="button" className={styles.primaryButton} onClick={verifyBackOfficePin} disabled={checkingBackOfficePin}>
                  {checkingBackOfficePin ? "กำลังตรวจสอบ..." : "ยืนยันรหัส"}
                </button>
              </div>
            </div>
          )}

          {isWalletPinOpen && (
            <div className={styles.reasonOverlay} onClick={() => setIsWalletPinOpen(false)}>
              <div className={styles.reasonSheet} onClick={(e) => e.stopPropagation()}>
                <div className={styles.sheetDragLine} />
                <h3 style={{ color: "white", marginBottom: "20px", textAlign: "center" }}>
                  ยืนยันตัวตน Wallet
                </h3>
                <label className={styles.fieldLabel}>
                  <span>รหัสผ่าน 6 หลัก</span>
                  <input
                    id="walletPin"
                    name="walletPin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="current-password"
                    maxLength={6}
                    value={walletPin}
                    onChange={(e) => setWalletPin(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void verifyWalletPin();
                    }}
                    placeholder="••••••"
                    autoFocus
                  />
                </label>
                <button type="button" className={styles.primaryButton} onClick={verifyWalletPin} disabled={checkingWalletPin}>
                  {checkingWalletPin ? "กำลังตรวจสอบ..." : "ยืนยันรหัส"}
                </button>
              </div>
            </div>
          )}

          {isLeaveLogPinOpen && (
            <div className={styles.reasonOverlay} onClick={() => setIsLeaveLogPinOpen(false)}>
              <div className={styles.reasonSheet} onClick={(e) => e.stopPropagation()}>
                <div className={styles.sheetDragLine} />
                <h3 style={{ color: "white", marginBottom: "20px", textAlign: "center" }}>ยืนยันตัวตน Log ลา</h3>
                <label className={styles.fieldLabel}>
                  <span>รหัสผ่าน 6 หลัก</span>
                  <input
                    id="leaveLogPin"
                    name="leaveLogPin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="current-password"
                    maxLength={6}
                    value={leaveLogPin}
                    onChange={(e) => setLeaveLogPin(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => { if (e.key === "Enter") void verifyLeaveLogPin(); }}
                    placeholder="••••••"
                    autoFocus
                  />
                </label>
                <button type="button" className={styles.primaryButton} onClick={verifyLeaveLogPin} disabled={checkingLeaveLogPin}>
                  {checkingLeaveLogPin ? "กำลังตรวจสอบ..." : "ยืนยันรหัส"}
                </button>
              </div>
            </div>
          )}

          {/* APP: Calculator (คงเดิม) */}
          {screen === "calculator" && (
            <div className={styles.appContainer}>
              <div className={styles.calcContainer}>
                <div className={styles.calculatorDisplay}>{calcDisplay}</div>
                <div className={styles.calculatorGrid}>
                  {calculatorButtons.map((btn) => (
                    <button key={btn.label} type="button" className={`${styles.calcKey} ${btn.type === 'top' ? styles.topOpKey : btn.type === 'side' ? styles.sideOpKey : styles.numKey}`} style={btn.isWide ? { gridColumn: 'span 2', borderRadius: '40px', aspectRatio: 'auto' } : {}} onClick={() => pressCalculatorKey(btn.label)}>
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* APP: Messages (คงเดิม) */}
          {screen === "messages" && (
            <div className={styles.appContainer}>
              <div className={styles.glassHeader}>
                <button type="button" className={styles.backButton} onClick={() => setScreen("home")}><span>‹</span> Back</button>
                <div className={styles.titleWrap}>System</div>
                <div style={{width: '50px'}}></div>
              </div>
              <div className={styles.appContent}>
                <div className={styles.messagePanel}>
                  <div className={`${styles.chatBubble} ${styles.chatReceived}`}>ยินดีต้อนรับสู่ระบบธนาคารแก๊ง! 💰</div>
                  {logs.length > 0 && logs.map((log) => (
                    <div key={log.id} className={`${styles.chatBubble} ${styles.chatSent}`}>
                      {getDisplayName(log)} {log.type === "deposit" ? "ฝาก" : "ถอน"}เงินจำนวน {log.amount.toLocaleString()} บาท {log.message ? ` • ${log.message}` : ""}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ACTION SHEET (คงเดิม) */}
          {isReasonSheetOpen && (
            <div className={styles.reasonOverlay} onClick={() => setIsReasonSheetOpen(false)}>
              <div className={styles.reasonSheet} onClick={(e) => e.stopPropagation()}>
                <div className={styles.sheetDragLine} />
                <h3 style={{color: 'white', marginBottom: '20px', textAlign: 'center'}}>
                  {selectedTab === "deposit" ? "ฝากเงินเข้าบัญชี" : "ถอนเงินออกจากบัญชี"}
                </h3>
                <label className={styles.fieldLabel}>
                  <span>จำนวนเงิน (บาท)</span>
                  <input id="transactionAmount" name="transactionAmount" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
                </label>
                <label className={styles.fieldLabel}>
                  <span>บันทึกช่วยจำ (Note)</span>
                  <textarea id="transactionMessage" name="transactionMessage" rows={2} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="ใส่เหตุผล..." />
                </label>
                <button type="button" className={styles.primaryButton} onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Processing..." : "ยืนยัน (Confirm)"}
                </button>
              </div>
            </div>
          )}

          {/* ตู้แก๊ง: Sheet เพิ่มไอเทมใหม่ */}
          {isAddItemSheetOpen && (
            <div className={styles.reasonOverlay} onClick={closeAddItemSheet}>
              <div className={styles.reasonSheet} onClick={(e) => e.stopPropagation()}>
                <div className={styles.sheetDragLine} />
                <h3 style={{ color: "white", marginBottom: "20px", textAlign: "center" }}>เพิ่มไอเทมใหม่</h3>
                <label className={styles.fieldLabel}>
                  <span>ชื่อไอเทม</span>
                  <input
                    id="newItemName"
                    name="newItemName"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder="เช่น ปืนไรเฟิล, ชุดปฐมพยาบาล"
                    autoFocus
                  />
                </label>
                <label className={styles.fieldLabel}>
                  <span>จำนวนเริ่มต้น</span>
                  <input
                    id="newItemQuantity"
                    name="newItemQuantity"
                    type="number"
                    inputMode="numeric"
                    value={newItemQuantity}
                    onChange={(e) => setNewItemQuantity(e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  <span>รูปไอเทม (ถ้ามี)</span>
                  <input type="file" accept="image/*" id="newItemImage" name="newItemImage" onChange={handleNewItemImageChange} hidden />
                  <label htmlFor="newItemImage" className={styles.iosUploadLabel}>
                    {newItemImagePreview ? (
                      <img src={newItemImagePreview} alt="Preview" className={styles.iosImagePreview} />
                    ) : (
                      <div className={styles.iosUploadPlaceholder}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                        <span>แตะเพื่อเลือกรูปไอเทม</span>
                      </div>
                    )}
                  </label>
                </label>
                <button type="button" className={styles.primaryButton} onClick={submitNewItem} disabled={savingItem}>
                  {savingItem ? "กำลังบันทึก..." : "เพิ่มไอเทม"}
                </button>
              </div>
            </div>
          )}

          {/* ตู้แก๊ง: Sheet เบิก / เติมจำนวน */}
          {isStockSheetOpen && stockSheetItem && (
            <div className={styles.reasonOverlay} onClick={() => setIsStockSheetOpen(false)}>
              <div className={styles.reasonSheet} onClick={(e) => e.stopPropagation()}>
                <div className={styles.sheetDragLine} />
                <h3 style={{ color: "white", marginBottom: "6px", textAlign: "center" }}>
                  {stockSheetMode === "add" ? `เพิ่มจำนวน • ${stockSheetItem.name}` : `เบิกของ • ${stockSheetItem.name}`}
                </h3>
                <div style={{ color: "rgba(255,255,255,0.5)", textAlign: "center", marginBottom: "18px", fontSize: "0.85rem" }}>
                  คงเหลือปัจจุบัน {stockSheetItem.quantity.toLocaleString()} ชิ้น
                </div>
                <label className={styles.fieldLabel}>
                  <span>จำนวน{stockSheetMode === "withdraw" ? "ที่เบิก" : "ที่เพิ่ม"}</span>
                  <input
                    id="stockAmount"
                    name="stockAmount"
                    type="number"
                    inputMode="numeric"
                    value={stockAmount}
                    onChange={(e) => setStockAmount(e.target.value)}
                    placeholder="0"
                    autoFocus
                  />
                </label>
                <label className={styles.fieldLabel}>
                  <span>หมายเหตุ (ถ้ามี)</span>
                  <input
                    id="stockNote"
                    name="stockNote"
                    value={stockNote}
                    onChange={(e) => setStockNote(e.target.value)}
                    placeholder="เช่น ใช้ในภารกิจ, ซื้อเพิ่ม..."
                  />
                </label>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={submitStockChange}
                  disabled={processingStockItemId === stockSheetItem.id}
                >
                  {processingStockItemId === stockSheetItem.id
                    ? "กำลังบันทึก..."
                    : stockSheetMode === "add"
                      ? "ยืนยันเพิ่มจำนวน"
                      : "ยืนยันเบิกของ"}
                </button>
              </div>
            </div>
          )}

          {/* ตู้แก๊ง: Sheet สรุป + ยืนยันเบิกของหลายชิ้นพร้อมกัน */}
          {isWithdrawCartSheetOpen && (
            <div className={styles.reasonOverlay} onClick={() => setIsWithdrawCartSheetOpen(false)}>
              <div className={styles.reasonSheet} onClick={(e) => e.stopPropagation()}>
                <div className={styles.sheetDragLine} />
                <h3 style={{ color: "white", marginBottom: "6px", textAlign: "center" }}>สรุปการเบิกของ</h3>
                <div style={{ color: "rgba(255,255,255,0.5)", textAlign: "center", marginBottom: "18px", fontSize: "0.85rem" }}>
                  {withdrawCartItemCount} ไอเทม • รวม {withdrawCartTotalUnits.toLocaleString()} ชิ้น
                </div>

                <div className={styles.cartSheetList}>
                  {withdrawCartEntries.map((entry) => (
                    <div key={entry.item.id} className={styles.cartSheetRow}>
                      <span className={styles.cartSheetItemName}>{entry.item.name}</span>
                      <span className={styles.cartSheetItemQty}>×{entry.qty.toLocaleString()}</span>
                    </div>
                  ))}
                </div>

                <label className={styles.fieldLabel}>
                  <span>หมายเหตุ (ถ้ามี)</span>
                  <input
                    id="withdrawCartNote"
                    name="withdrawCartNote"
                    value={withdrawCartNote}
                    onChange={(e) => setWithdrawCartNote(e.target.value)}
                    placeholder="เช่น ใช้ในภารกิจ..."
                  />
                </label>

                <button type="button" className={styles.primaryButton} onClick={submitWithdrawCart} disabled={submittingWithdrawCart}>
                  {submittingWithdrawCart ? "กำลังบันทึก..." : `ยืนยันเบิกของทั้งหมด (${withdrawCartTotalUnits.toLocaleString()} ชิ้น)`}
                </button>
              </div>
            </div>
          )}

          {/* Home Indicator */}
          <div className={styles.homeIndicator} onClick={() => { cancelWithdrawMode(); if (screen !== "home") setScreen("home"); else setIsLocked(true); }} />
        </div>
      </div>
      </main>
    </AuthGuard>
  );
}