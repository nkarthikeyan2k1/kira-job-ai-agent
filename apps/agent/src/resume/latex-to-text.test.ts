import { describe, expect, it } from "vitest";
import { latexToText } from "./latex-to-text.ts";

// A fictional resume in the structure RenderCV / Overleaf templates produce.
const RENDERCV = String.raw`
\documentclass[10pt, a4paper]{article}
\usepackage{hyperref} % preamble is ignored
\newcommand{\ignored}{PREAMBLE TEXT}
\begin{document}
    \newcommand{\AND}{\unskip \cleaders\copy\ANDbox\hskip\wd\ANDbox \ignorespaces}
    \newsavebox\ANDbox
    \sbox\ANDbox{$|$}

    \begin{header}
        {\color{accentColor}\fontsize{25pt}{25pt}\selectfont\bfseries Asha Rao}
        \normalsize
        \mbox{Pune, MH}%
        \kern 8pt%
        \AND%
        \kern 8pt%
        \mbox{\hrefWithoutArrow{mailto:asha@example.com}{\underline{asha@example.com}}}%
    \end{header}

    \vspace{5 pt - 0.3 cm}

    \section{Summary}
    \begin{onecolentry}
        Backend developer with \textbf{6 years} of experience in
        \textbf{payments \& billing}. Cut costs by \textbf{40\%}.
    \end{onecolentry}

    \section{Technical Skills}
    \begin{onecolentry}
        % \begin{highlightsforbulletentries}
        {\fontsize{11pt}{11pt}\selectfont \textbf{Backend:}} {Node.js, C\#, gRPC} \\
        {\fontsize{11pt}{11pt}\selectfont \textbf{Data:}} {PostgreSQL, Redis}\\
    \end{onecolentry}

    \section{Experience}
        \begin{twocolentry}{
            Jan 2022 – Present
            Pune, India
        }
        {\Large \textbf{Acme Payments}} \\ Senior Developer
        \end{twocolentry}
        \vspace{0.10 cm}
        \begin{onecolentry}
            \begin{highlights}
            \item Built a ledger service handling \textbf{2M+ requests} a day.

            \item Reduced p99 latency by \textbf{35\%} -- measured in production.
            \end{highlights}
        \end{onecolentry}

    % \section{Old Section}
    %     \item A commented-out bullet that must not appear.

    \section{Education}
        \begin{twocolentry}{ 2014 -- 2018 }
            \textbf{B.E. Computer Science} -- Example University \,|\, CGPA: 8.1/10
        \end{twocolentry}
\end{document}
`;

describe("latexToText", () => {
  const text = latexToText(RENDERCV);

  it("produces headings, entry lines and bullets", () => {
    expect(text).toBe(
      [
        "Asha Rao Pune, MH asha@example.com",
        "",
        "# Summary",
        "",
        "Backend developer with 6 years of experience in payments & billing. Cut costs by 40%.",
        "",
        "# Technical Skills",
        "",
        "Backend: Node.js, C#, gRPC",
        "Data: PostgreSQL, Redis",
        "",
        "# Experience",
        "",
        "Jan 2022 – Present Pune, India",
        "Acme Payments",
        "Senior Developer",
        "",
        "- Built a ledger service handling 2M+ requests a day.",
        "- Reduced p99 latency by 35% – measured in production.",
        "",
        "# Education",
        "",
        "2014 – 2018",
        "B.E. Computer Science – Example University | CGPA: 8.1/10",
      ].join("\n"),
    );
  });

  it("drops the preamble, comments and LaTeX commands", () => {
    expect(text).not.toMatch(/PREAMBLE|Old Section|commented-out|\\|[{}]|mailto/);
  });

  it("keeps a link's label, not its URL", () => {
    expect(latexToText(String.raw`See \href{https://example.com/demo}{Live Demo} today`)).toBe("See Live Demo today");
  });

  it("handles plain itemize lists and explicit line breaks", () => {
    const tex = String.raw`\textbf{Acme,} Developer \hfill Pune\\[5pt]
\begin{itemize}[leftmargin=0.6cm]
\item First \textit{thing}
\item Second thing
\end{itemize}`;
    expect(latexToText(tex)).toBe("Acme, Developer Pune\n\n- First thing\n- Second thing");
  });
});
