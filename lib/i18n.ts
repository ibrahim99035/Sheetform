// Lightweight bilingual dictionary for core chrome (nav, auth, settings).
// Landing pages stay dual-language statically; workspace surfaces remain
// English until their strings are migrated key by key.

export type Lang = "en" | "ar";

export const LANGS: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
];

const en = {
  // App shell
  "nav.dashboard": "Dashboard",
  "nav.datasets": "Datasets",
  "nav.reports": "Reports",
  "nav.applications": "Applications",
  "nav.newDataset": "New dataset",
  "nav.admin": "Admin",
  "nav.settings": "Settings",
  "nav.signOut": "Sign out",
  "nav.home": "SiroQ home",

  // Auth
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.passwordHint": "At least 8 characters.",
  "auth.signIn": "Sign in",
  "auth.signingIn": "Signing in…",
  "auth.forgot": "Forgot password?",
  "auth.createAccount": "Create account",
  "auth.creatingAccount": "Creating account…",
  "auth.noAccount": "No account?",
  "auth.haveAccount": "Already have an account?",
  "auth.createOne": "Create one",
  "auth.signInTitle": "Welcome back",
  "auth.signInSubtitle": "Sign in to continue to your datasets.",
  "auth.signUpTitle": "Create your account",
  "auth.signUpSubtitle": "Register your pharmacy to start turning spreadsheets into insights.",
  "auth.forgotTitle": "Reset your password",
  "auth.forgotSubtitle": "Enter your email and we'll send you a reset link.",
  "auth.resetTitle": "Set new password",
  "auth.resetSubtitle": "Enter your new password below.",

  // Signup — pharmacy details
  "signup.pharmacyDetails": "Pharmacy details",
  "signup.yourName": "Your name",
  "signup.yourNamePlaceholder": "e.g. Ahmed Hassan",
  "signup.pharmacyName": "Pharmacy name",
  "signup.pharmacyNamePlaceholder": "e.g. El-Nasr Pharmacy",
  "signup.licenseNo": "License number",
  "signup.licenseExpiry": "License expiry",
  "signup.phone": "Phone",
  "signup.phonePlaceholder": "e.g. +20 100 123 4567",
  "signup.address": "Address",
  "signup.addressPlaceholder": "Street, city, governorate",

  // Settings
  "settings.title": "Settings",
  "settings.subtitle": "Manage your account settings.",
  "settings.orgCard.title": "Organization",
  "settings.save": "Save",
  "settings.saving": "Saving…",
};

const ar: Record<keyof typeof en, string> = {
  // App shell
  "nav.dashboard": "لوحة التحكم",
  "nav.datasets": "بيانات",
  "nav.reports": "التقارير",
  "nav.applications": "الطلبات",
  "nav.newDataset": "بيانات جديدة",
  "nav.admin": "الإدارة",
  "nav.settings": "الإعدادات",
  "nav.signOut": "تسجيل الخروج",
  "nav.home": "الصفحة الرئيسية",

  // Auth
  "auth.email": "البريد الإلكتروني",
  "auth.password": "كلمة المرور",
  "auth.passwordHint": "٨ أحرف على الأقل.",
  "auth.signIn": "تسجيل الدخول",
  "auth.signingIn": "جارٍ تسجيل الدخول…",
  "auth.forgot": "نسيت كلمة المرور؟",
  "auth.createAccount": "إنشاء حساب",
  "auth.creatingAccount": "جارٍ إنشاء الحساب…",
  "auth.noAccount": "لا تملك حساباً؟",
  "auth.haveAccount": "لديك حساب بالفعل؟",
  "auth.createOne": "أنشئ حساباً",
  "auth.signInTitle": "مرحباً بعودتك",
  "auth.signInSubtitle": "سجّل الدخول للوصول إلى بياناتك.",
  "auth.signUpTitle": "أنشئ حسابك",
  "auth.signUpSubtitle": "سجّل صيدليتك لتحويل جداول البيانات إلى رؤى.",
  "auth.forgotTitle": "إعادة تعيين كلمة المرور",
  "auth.forgotSubtitle": "أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين.",
  "auth.resetTitle": "تعيين كلمة مرور جديدة",
  "auth.resetSubtitle": "أدخل كلمة المرور الجديدة أدناه.",

  // Signup — pharmacy details
  "signup.pharmacyDetails": "بيانات الصيدلية",
  "signup.yourName": "اسمك",
  "signup.yourNamePlaceholder": "مثال: أحمد حسن",
  "signup.pharmacyName": "اسم الصيدلية",
  "signup.pharmacyNamePlaceholder": "مثال: صيدلية النصر",
  "signup.licenseNo": "رقم الترخيص",
  "signup.licenseExpiry": "انتهاء الترخيص",
  "signup.phone": "الهاتف",
  "signup.phonePlaceholder": "مثال: +20 100 123 4567",
  "signup.address": "العنوان",
  "signup.addressPlaceholder": "الشارع، المدينة، المحافظة",

  // Settings
  "settings.title": "الإعدادات",
  "settings.subtitle": "إدارة إعدادات حسابك.",
  "settings.orgCard.title": "المؤسسة",
  "settings.save": "حفظ",
  "settings.saving": "جارٍ الحفظ…",
};

export const DICT: Record<Lang, Record<keyof typeof en, string>> = { en, ar };

export type TKey = keyof typeof en;

export function translate(lang: Lang, key: TKey): string {
  return DICT[lang][key] ?? en[key];
}
