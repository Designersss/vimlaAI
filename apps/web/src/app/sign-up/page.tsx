import type { ReactElement } from "react";
import Link from "next/link";
import { AuthForm } from "../../features/auth/components/AuthForm/AuthForm";
import styles from "../page.module.scss";

export default function SignUpPage(): ReactElement {
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Vimla</p>
      <h1 className={styles.heading}>Create account</h1>
      <AuthForm mode="sign-up" />
      <p className={styles.copy}>
        Already registered? <Link href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
