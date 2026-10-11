import type { ReactNode } from "react";
import { Button, Heading, Section, Text } from "react-email";

export function EmailHeading({ children }: { children: ReactNode }) {
  return (
    <Heading
      as="h2"
      className="mb-4 mt-0 text-[28px] font-bold uppercase leading-[1.4]"
    >
      {children}
    </Heading>
  );
}

export function EmailText({ children }: { children: ReactNode }) {
  return (
    <Text className="mb-6 mt-0 text-[17px] leading-[1.4]">{children}</Text>
  );
}

export function EmailButton({
  href,
  children
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Section className="mb-4">
      <Button
        href={href}
        className="inline-block bg-white px-6 py-[14px] text-center text-[17px] font-bold leading-[1.4] text-black no-underline"
      >
        {children}
      </Button>
    </Section>
  );
}

export function EmailDetails({ children }: { children: ReactNode }) {
  return (
    <Section className="mb-6 border border-solid border-white p-4">
      {children}
    </Section>
  );
}

export function EmailField({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <Text className="mb-1 mt-0 text-[11px] uppercase leading-[1.4]">
        {label}
      </Text>
      <Text className="mb-3 mt-0 text-[17px] leading-[1.4]">{children}</Text>
    </>
  );
}

export type EmailProps = {
  locale?: "es" | "en";
  fontUrl?: string;
  subject?: string;
};
