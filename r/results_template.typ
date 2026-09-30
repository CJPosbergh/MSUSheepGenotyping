// Results report for one submission. reports.R writes data.json next to this file and compiles it with
// `quarto typst compile`. Edit wording and layout here; the numbers and names come from the tracker.
#let d = json("data.json")

#let navy = rgb("#16233A")
#let ink2 = rgb("#3E4A5C")
#let muted = rgb("#5A6474")
#let label = rgb("#4A5566")
#let line = rgb("#E2DED3")
#let line2 = rgb("#EEEBE3")
#let head = rgb("#F1EEE6")
#let tones = (
  good: (rgb("#DCE8F5"), rgb("#123C69")),
  mid: (rgb("#FBEBC8"), rgb("#6B4A07")),
  bad: (rgb("#F8D7CC"), rgb("#7A2512")),
  "none": (rgb("#EFECE3"), rgb("#4A5566")),
)
#let sans = ("Public Sans", "Arial", "Helvetica", "Liberation Sans", "DejaVu Sans")
#let serif = ("Fraunces", "Georgia", "Libertinus Serif")
#let mono = ("IBM Plex Mono", "Consolas", "Menlo", "DejaVu Sans Mono")

#set page(paper: "us-letter", flipped: true, margin: (x: 0.45in, top: 0.4in, bottom: 0.55in),
  footer: context [
    #set text(size: 7pt, fill: muted)
    #d.footer_left #h(1fr) Page #counter(page).display() of #counter(page).final().first()
  ])
#set text(font: sans, size: 8.5pt, fill: navy)
#set par(leading: 0.5em)

#let chip(lbl, cat) = {
  let t = tones.at(if cat in tones { cat } else { "none" })
  box(fill: t.at(0), radius: 8pt, inset: (x: 5pt, y: 2.5pt), text(size: 7pt, weight: "semibold", fill: t.at(1), lbl))
}
#let caps(s) = text(size: 7pt, weight: "bold", fill: label, tracking: 0.3pt, upper(s))

// ---------------------------------------------------------------- header band
#block(width: 100%, fill: navy, radius: 6pt, inset: (x: 14pt, y: 10pt))[
  #grid(columns: (auto, 1fr, auto), column-gutter: 10pt, align: horizon,
    image("logo.svg", width: 24pt),
    [#text(fill: white, weight: "bold", size: 10pt)[Sheep Genotyping Service] \
     #text(fill: rgb("#C9D2E0"), size: 7.5pt)[Montana State University · Sheep Program]],
    align(right)[#text(fill: rgb("#C9D2E0"), size: 7.5pt)[Results report] \ #text(fill: white, font: mono, size: 8pt, d.sub_id)])
]
#v(6pt)
#text(font: serif, size: 22pt, weight: "semibold", d.title)
#v(-4pt)
#grid(columns: (1fr, auto), text(fill: ink2, d.contact_line), text(fill: ink2, d.subtitle_right))
#v(4pt)

// ---------------------------------------------------------------- summary tiles
#grid(columns: (1fr,) * d.stats.len(), column-gutter: 8pt,
  ..d.stats.map(s => block(width: 100%, stroke: 0.6pt + line, radius: 5pt, inset: (x: 8pt, y: 6pt))[
    #text(size: 7pt, fill: muted, s.label) \
    #text(font: serif, size: 15pt, weight: "semibold",
      fill: if s.tone == "bad" { tones.bad.at(1) } else if s.tone == "mid" { tones.mid.at(1) } else { navy }, str(s.value))
  ]))
#v(6pt)

// ---------------------------------------------------------------- results table
#let ncond = d.columns.len()
#let colw = (0.9fr, 1.35fr, 0.75fr) + (1.45fr,) * ncond + (1.5fr,)
#let heads = ([ANIMAL], [EID / NSIP ID], [BATCH]) + d.columns.map(c => [#upper(c.head)]) + ([PARENTAGE],)
#let rows = ()
#for a in d.animals {
  let first = ([#text(weight: "bold", size: 9pt, a.tag) \ #text(size: 7pt, fill: muted, a.info)],
    [#text(font: mono, size: 7.5pt, a.eid) \ #text(font: mono, size: 7pt, fill: muted, a.nsip)],
    text(font: mono, size: 7.5pt, a.batch))
  if a.state == "ok" {
    rows += first + a.cells.map(c => if c.label == "" { text(fill: muted, "—") } else [#chip(c.label, c.cat) \ #text(font: mono, size: 7pt, fill: muted, c.detail)])
    let pc = tones.at(a.parent.tone, default: (none, muted)).at(1)
    rows += ([#text(weight: "bold", fill: pc, a.parent.main) #if a.parent.sub != "" [\ #text(size: 7pt, fill: muted, a.parent.sub)]],)
  } else {
    let t = if a.state == "qc" { tones.bad } else if a.state == "missing" { tones.mid } else { tones.none }
    rows += first + (table.cell(colspan: ncond + 1, fill: t.at(0).lighten(55%))[#text(weight: "bold", fill: t.at(1), a.note_title) #h(3pt) · #h(3pt) #text(fill: ink2, a.note)],)
  }
}
#table(columns: colw, stroke: (x, y) => if y > 0 { (top: 0.5pt + line2) } else { none },
  fill: (x, y) => if y == 0 { head } else { none }, inset: (x: 5pt, y: 5pt), align: (x, y) => horizon + left,
  table.header(..heads.map(h => text(size: 6.8pt, weight: "bold", fill: label, tracking: 0.3pt, h))),
  ..rows)

// ---------------------------------------------------------------- how to read
#v(8pt)
#text(font: serif, size: 14pt, weight: "semibold")[How to read these results]
#v(2pt)
#let box2(title, body, chips) = block(width: 100%, stroke: 0.6pt + line, radius: 5pt, inset: 9pt, breakable: false)[
  #text(weight: "bold", size: 9pt, title) #v(-2pt)
  #text(fill: ink2, body)
  #if chips.len() > 0 [ #v(-2pt) #chips.map(c => chip(c.label, c.cat)).join(h(4pt)) ]
]
#grid(columns: (1fr, 1fr), column-gutter: 8pt, row-gutter: 8pt,
  ..d.explain.map(e => box2(e.title, e.text, e.chips)))
#if d.todo.len() > 0 {
  v(8pt)
  block(width: 100%, stroke: 0.6pt + line, radius: 5pt, inset: 9pt, breakable: false)[
    #text(weight: "bold", size: 9pt)[What to do next] #v(-2pt)
    #for n in d.todo [#text(weight: "bold", n.tag + ":") #n.text \ ]
  ]
}
#v(6pt)
#text(size: 7.5pt, fill: muted, d.contact)
