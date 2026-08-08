export interface FaqItem {
  question: string;
  answer: string;
}

export function FaqSection({
  items,
  heading = "Frequently asked",
}: {
  items: FaqItem[];
  heading?: string;
}) {
  return (
    <section className="border-t border-border py-16">
      <div className="container max-w-2xl">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {heading}
        </h2>
        <dl className="mt-5 divide-y divide-border">
          {items.map((item) => (
            <div key={item.question} className="py-5 first:pt-0">
              <dt className="font-medium">{item.question}</dt>
              <dd className="mt-2 text-sm text-muted-foreground">
                {item.answer}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
