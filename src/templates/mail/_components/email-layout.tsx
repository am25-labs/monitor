import { product } from "../../../shared/product";
import type { ReactNode } from "react";
import {
  Body,
  Container,
  Font,
  Head,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
  pixelBasedPreset
} from "react-email";

type EmailLayoutProps = {
  children: ReactNode;
  subject: string;
  preview: string;
  fontUrl?: string;
  lang?: "es" | "en";
};

export function EmailLayout({
  children,
  subject,
  preview,
  fontUrl,
  lang = "es"
}: EmailLayoutProps) {
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
        <Body
          lang={lang}
          className="m-0 bg-black p-0 text-white font-['Martian_Mono',Arial,sans-serif]"
        >
          <Section className="p-6 max-[620px]:p-3">
            <Container className="w-full max-w-[600px] bg-black text-white">
              <Section className="px-12 max-[620px]:px-6 pt-12 max-[620px]:pt-6">
                <Text className="m-0 text-[20px] font-bold leading-[1.4] text-white">
                  {product.name}
                </Text>
              </Section>
              <Section className="p-12 max-[620px]:p-6 text-[17px] leading-[1.4]">
                {children}
              </Section>
              <Section className="p-6 text-center text-xs text-white">
                <Text className="m-0 text-xs leading-[1.4]">
                  &copy; {new Date().getFullYear()} {product.copyright}
                </Text>
                <Text className="mb-0 mt-[6px] text-xs leading-[1.4]">
                  <Link
                    href={product.repository}
                    className="mx-[5px] text-white no-underline"
                  >
                    {product.name}
                  </Link>
                  <Link
                    href={`${product.repository}/blob/main/LICENSE`}
                    className="mx-[5px] text-white no-underline"
                  >
                    {product.license}
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
