import { ButtonLink, Screen } from "@/components/Chrome";
import { Tape } from "@/components/ui/Tape";

export default function NotFound() {
  return (
    <Screen>
      <div className="pt-10">
        <Tape className="px-5 py-8 text-center">
          <h1 className="text-xl font-bold text-ink">לא מצאנו את הדף הזה</h1>
          <div aria-hidden className="mx-auto my-3 w-16 border-t-2 border-dotted border-paper-line" />
          <p className="text-sm leading-relaxed text-ink-2">אולי הקישור ישן, או שהבירה או הרשת כבר לא ברשימה.</p>
          <div className="mt-5 flex flex-col items-center gap-2">
            <ButtonLink href="/beer">לחיפוש בירה</ButtonLink>
            <ButtonLink href="/" variant="quiet">
              חזרה למבצעים
            </ButtonLink>
          </div>
        </Tape>
      </div>
    </Screen>
  );
}
