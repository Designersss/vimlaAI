import type { ReactElement } from "react";
import Link from "next/link";
import { AuthForm } from "../../features/auth/components/AuthForm/AuthForm";
import styles from "../page.module.scss";

export default function SignInPage(): ReactElement {
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Vimla</p>
      <h1 className={styles.heading}>Sign in</h1>
      <AuthForm mode="sign-in" />
      <p className={styles.copy}>
        No account? <Link href="/sign-up">Create one</Link>
      </p>
    </main>
  );
}
