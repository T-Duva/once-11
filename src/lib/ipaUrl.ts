import { resolveServerOrigin } from './server'
import { versionToReleaseTag } from './apkUrl'

/** IPA en GitHub (mismo tag que el APK). */
export function ipaDownloadUrl(_origin?: string): string {
  return 'https://github.com/T-Duva/once-11/releases/latest/download/once-11.ipa'
}

export function githubIpaUrl(version: string): string {
  return `https://github.com/T-Duva/once-11/releases/download/${versionToReleaseTag(version)}/once-11.ipa`
}

/** Link OTA: Safari en iPhone instala la app nativa (no es “Agregar a inicio”). */
export async function iosInstallUrl(): Promise<string> {
  const origin = await resolveServerOrigin()
  return `${origin.replace(/\/$/, '')}/ios/install`
}

export async function ipaDownloadCandidates(remoteVersion?: string): Promise<string[]> {
  const urls: string[] = []
  if (remoteVersion) urls.push(githubIpaUrl(remoteVersion))
  urls.push(ipaDownloadUrl())
  try {
    const origin = await resolveServerOrigin()
    urls.push(`${origin.replace(/\/$/, '')}/once-11.ipa`)
  } catch {
    /* sin server */
  }
  return [...new Set(urls.filter(Boolean))]
}
