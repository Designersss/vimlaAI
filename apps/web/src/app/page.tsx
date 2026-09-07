import Link from "next/link";
import type { ReactElement } from "react";
import { fetchApiHealth } from "../shared/api/health";
import { HealthStatus } from "../features/health/components/HealthStatus/HealthStatus";
import { publicWebConfig } from "../shared/config/public-env";
import styles from "./page.module.scss";

export const dynamic = "force-dynamic";

export default async function HomePage(): Promise<ReactElement> {
  let initialError: string | null = null;
  let initialHealth = null;

  try {
    initialHealth = await fetchApiHealth();
  } catch (error: unknown) {
    initialError =
      error instanceof Error ? error.message : "Unable to reach the Vimla API";
  }

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Vimla</p>
      <h1 className={styles.heading}>Workspace foundation</h1>
      <p className={styles.copy}>
        API base URL: <code>{publicWebConfig.apiBaseUrl}</code>
      </p>
      <p className={styles.copy}>
        <Link href="/sign-in">Sign in</Link>
        {" · "}
        <Link href="/sign-up">Create account</Link>
      </p>
      <HealthStatus initialHealth={initialHealth} initialError={initialError} />
    </main>
  );
}
