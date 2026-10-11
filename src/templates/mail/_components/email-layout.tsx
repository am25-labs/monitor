import type { ReactNode } from "react";
import {
  Body,
  Container,
  Font,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
  pixelBasedPreset,
} from "react-email";

type EmailLayoutProps = {
  children: ReactNode;
  subject: string;
  preview: string;
  fontUrl?: string;
  lang?: "es" | "en";
};

export function EmailLayout({ children, subject, preview, fontUrl, lang = "es" }: EmailLayoutProps) {
  return (
    <Html lang={lang}>
      <Tailwind config={{ presets: [pixelBasedPreset] }}>
        <Head>
          <title>{subject}</title>
          <Font
            fontFamily="Martian Mono"
            fallbackFontFamily="Arial"
            webFont={fontUrl ? { url: fontUrl, format: "truetype" } : undefined}
            fontWeight={400}
            fontStyle="normal"
          />
        </Head>
        <Preview>{preview}</Preview>
        <Body lang={lang} className="m-0 bg-white p-0 font-['Martian_Mono',Arial,sans-serif]">
          <Section className="p-6 max-[620px]:p-3">
            <Container className="w-full max-w-[600px] bg-[#0000f2] text-white">
              <Section className="px-12 max-[620px]:px-6 pt-12 max-[620px]:pt-6">
                <Img
                  src="https://am25.work/am25-logo.svg"
                  width="133"
                  height="48"
                  alt="AM25"
                  className="block"
                />
              </Section>
              <Section className="p-12 max-[620px]:p-6 text-[17px] leading-[1.4]">
                {children}
              </Section>
              <Section className="p-6 text-center text-xs text-white">
                <Text className="m-0 text-xs leading-[1.4]">
                  &copy; {new Date().getFullYear()} AM25, S.A.S. DE C.V.
                </Text>
                <Text className="mb-0 mt-[6px] text-xs leading-[1.4]">
                  <Link href={`https://am25.work/${lang}/contact/general`} className="mx-[5px] text-white no-underline">
                    {lang === "en" ? "Contact" : "Contacto"}
                  </Link>
                  <Link href={`https://am25.work/${lang}/privacy/data-protection`} className="mx-[5px] text-white no-underline">
                    {lang === "en" ? "Data protection" : "Protección de datos"}
                  </Link>
                </Text>
              </Section>
            </Container>
          </Section>
        </Body>
      </Tailwind>
    </Html>
  );
}
