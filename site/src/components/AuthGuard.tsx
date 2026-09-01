"use client";

import { useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { usePathname, useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";

const LOGIN_PATH = "/";
export default function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
      if (!user) {
        router.replace(LOGIN_PATH);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [pathname, router]);

  if (!authReady || !authUser) {
    return null;
  }

  return children;
}
