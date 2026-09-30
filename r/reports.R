# =============================================================================
# reports.R
# Producer results files for one submission: a PDF report (Quarto + Typst) and
# an Excel file (Results + How to read). Saves both in the submission's Drive
# folder and writes their links to Submissions > Results_PDF / Results_Excel,
# which is what the producer's results page downloads once results are released.
#
# Needs: install.packages(c("googlesheets4", "googledrive", "openxlsx", "jsonlite"))
#        Quarto (https://quarto.org) for the PDF. It includes Typst; nothing else to install.
#
# Typical use, after push_results() / push_parentage():
#   source("tracker_push.R"); source("reports.R")
#   reports_auth()                                  # once per R session
#   results_report("P003-01")                       # one submission
#   results_reports(batch = "B2026-01")             # every submission in a batch
#   results_report("P003-01", upload = FALSE)       # just make the files locally to look at
#
# Then release from the Sheet: Genotyping > Release results for selected submission.
# The report includes every result row for the submission, released or not,
# so make the files first and release after checking them.
# =============================================================================

REPORT_DIR <- "reports"                                   # local copies go here
QUARTO     <- Sys.getenv("QUARTO_PATH", "quarto")         # or the full path to quarto

.here_dir <- function() {
  f <- tryCatch(normalizePath(sys.frame(1)$ofile), error = function(e) NULL)
  if (is.null(f)) getwd() else dirname(f)
}
REPORT_TEMPLATE_DIR <- .here_dir()                        # where results_template.typ and logo.svg live

reports_auth <- function(email = SERVICE_EMAIL) {
  googledrive::drive_auth(email = email)
  googlesheets4::gs4_auth(token = googledrive::drive_token())
}

# Drive upload, kept beside the Sheet access in tracker_push.R so tests can swap it out.
.tracker_io$upload <- function(path, folder_url) {
  fid <- regmatches(folder_url, regexpr("[-_A-Za-z0-9]{20,}", folder_url))
  if (!length(fid)) stop("No Drive folder link for this submission.", call. = FALSE)
  f <- googledrive::drive_put(media = path, path = googledrive::as_id(fid), name = basename(path))
  paste0("https://drive.google.com/file/d/", f$id[1], "/view")
}

.settings <- function(ss) {
  s <- .tracker_io$read(ss, "Settings")
  stats::setNames(as.list(s$Value), s$Setting)
}

.fmt_date <- function(x) {
  x <- .clean(x)
  d <- suppressWarnings(as.Date(substr(x, 1, 10)))
  ifelse(is.na(d), x, sub("^0", "", format(d, "%d %b %Y")))
}

.short <- function(name) sub("\\s+susceptibility$", "", name, ignore.case = TRUE)

# Everything about one submission, from the tracker.
.report_data <- function(sid, ss) {
  subs <- .tracker_io$read(ss, "Submissions")
  sub <- subs[match(sid, subs$Submission_ID), , drop = FALSE]
  if (!nrow(sub) || is.na(sub$Submission_ID)) stop("No submission ", sid, " on the tracker.", call. = FALSE)
  prod <- .tracker_io$read(ss, "Producers")
  p <- prod[match(sub$Producer_ID, prod$Producer_ID), , drop = FALSE]
  animals <- .tracker_io$read(ss, "Animals")
  animals <- animals[animals$Submission_ID == sid, , drop = FALSE]
  if (!nrow(animals)) stop(sid, " has no animals.", call. = FALSE)
  res <- .tracker_io$read(ss, "Results");   res <- res[res$Submission_ID == sid, , drop = FALSE]
  par <- .tracker_io$read(ss, "Parentage"); par <- par[par$Submission_ID == sid, , drop = FALSE]
  repl <- .tracker_io$read(ss, "Replacements"); repl <- repl[repl$Submission_ID == sid, , drop = FALSE]
  conds <- .tracker_io$read(ss, "Conditions")
  conds <- conds[.clean(conds$Active) == "Y", , drop = FALSE]
  conds <- conds[order(suppressWarnings(as.numeric(conds$Sort_Order))), , drop = FALSE]
  key <- .tracker_io$read(ss, "Result_Key")
  list(sub = sub, p = p, animals = animals, res = res, par = par, repl = repl, conds = conds, key = key, s = .settings(ss))
}

# What state each animal is in for the report: ok / qc / missing / pending
.animal_state <- function(D) {
  a <- D$animals
  has <- a$Animal_Key %in% D$res$Animal_Key
  open <- D$repl[.clean(D$repl$Received) != "Y", , drop = FALSE]
  reason <- open$Reason[match(a$Animal_Key, open$Animal_Key)]
  st <- ifelse(has, "ok",
        ifelse(a$Sample_Status == "Failed QC" | (!is.na(reason) & reason == "Failed QC"), "qc",
        ifelse(a$Sample_Status == "Not received" | (!is.na(reason) & reason == "Not received"), "missing", "pending")))
  list(state = st, replacement = !is.na(reason))
}

.parent_text <- function(a, pr) {
  if (.clean(a$Test_Parentage) == "N") return(list(main = "Not requested", sub = "", tone = "none"))
  if (is.null(pr) || !nrow(pr)) return(list(main = "Pending", sub = "", tone = "none"))
  bits <- character(0); bad <- FALSE
  for (who in c("Sire", "Dam")) {
    r <- .clean(pr[[paste0(who, "_Result")]]); rep <- .clean(pr[[paste0("Reported_", who)]]); asg <- .clean(pr[[paste0(who, "_Assigned")]])
    if (r == "" || r == "Not requested") next
    bits <- c(bits, switch(r,
      "Confirmed" = paste0(who, " confirmed", if (nzchar(rep) || nzchar(asg)) paste0(": ", if (nzchar(rep)) rep else asg) else ""),
      "Excluded" = { bad <- TRUE; paste0("Recorded ", tolower(who), " excluded", if (nzchar(asg)) paste0(" \u00b7 matches ", asg) else "") },
      "Not genotyped" = paste0(who, " not genotyped"),
      paste(who, tolower(r))))
  }
  notes <- .clean(pr$Notes)
  list(main = if (length(bits)) bits[1] else "Pending",
       sub = paste(c(bits[-1], if (nzchar(notes)) notes), collapse = " \u00b7 "),
       tone = if (bad) "bad" else if (length(bits)) "good" else "none")
}

.tag <- function(a) ifelse(.clean(a$Flock_Tag) != "", .clean(a$Flock_Tag), .clean(a$EID))

# ---------------------------------------------------------------------------- PDF
.pdf_json <- function(D) {
  a <- D$animals; st <- .animal_state(D); s <- D$s
  sid <- D$sub$Submission_ID
  n <- nrow(a)
  breed <- if (nzchar(.clean(D$sub$Breed))) .clean(D$sub$Breed) else paste(unique(.clean(a$Breed)), collapse = ", ")
  sex <- c(M = "Male", F = "Female")
  cols <- lapply(seq_len(nrow(D$conds)), function(i) {
    g <- .clean(D$conds$Gene_Marker[i]); g <- sub("\\s*\\(.*$", "", g)
    list(id = D$conds$Condition_ID[i], head = paste0(.short(D$conds$Display_Name[i]), if (nzchar(g)) paste0(" \u00b7 ", g) else ""))
  })
  rows <- lapply(seq_len(n), function(i) {
    ai <- a[i, , drop = FALSE]
    cells <- lapply(D$conds$Condition_ID, function(cid) {
      r <- D$res[D$res$Animal_Key == ai$Animal_Key & toupper(D$res$Condition_ID) == toupper(cid), , drop = FALSE]
      if (!nrow(r)) return(list(label = "", cat = "none", detail = ""))
      call <- .clean(r$Call[1]); lab <- .clean(r$Result_Label[1]); geno <- .clean(r$Genotype[1])
      list(label = if (nzchar(call) && call != geno) paste0(call, " \u00b7 ", lab) else if (nzchar(lab)) lab else call,
           cat = .clean(r$Category[1]), detail = geno)
    })
    state <- st$state[i]
    note <- switch(state,
      qc = if (st$replacement[i]) c("Resample needed", "A replacement TSU is on its way; its result will follow.")
           else c("Resample needed", "This TSU failed the lab quality check. Please send a replacement TSU (free) from your results page."),
      missing = if (st$replacement[i]) c("Sample not received", "The TSU is on its way to us; its result will follow.")
                else c("Sample not received", "This TSU was on your form but not in the package we received."),
      pending = c("Results pending", "This sample is still being processed."),
      c("", ""))
    list(tag = .tag(ai), info = paste(c(unname(sex[.clean(ai$Sex)]), .clean(ai$Year_of_Birth)), collapse = " \u00b7 "),
         eid = if (nzchar(.clean(ai$EID))) .clean(ai$EID) else "\u2014",
         nsip = if (nzchar(.clean(ai$NSIP_ID))) .clean(ai$NSIP_ID) else "Not NSIP-enrolled",
         batch = if (nzchar(.clean(ai$Batch))) .clean(ai$Batch) else "\u2014",
         state = state, note_title = note[1], note = note[2], cells = cells,
         parent = .parent_text(ai, D$par[D$par$Animal_Key == ai$Animal_Key, , drop = FALSE]))
  })
  explain <- lapply(seq_len(nrow(D$conds)), function(i) {
    k <- D$key[toupper(D$key$Condition_ID) == toupper(D$conds$Condition_ID[i]), , drop = FALSE]
    g <- .clean(D$conds$Gene_Marker[i]); g <- sub("\\s*\\(.*$", "", g)
    list(title = paste0(D$conds$Display_Name[i], if (nzchar(g)) paste0(" (", g, ")") else ""),
         text = .clean(D$conds$Explanation[i]),
         chips = lapply(unique(k$Result_Label), function(lab) {       # "2/2 \u00b7 2/3 Higher risk"
           w <- k$Result_Label == lab
           list(label = paste(paste(k$Call[w], collapse = " \u00b7 "), lab), cat = .clean(k$Category[w][1]))
         }))
  })
  explain[[length(explain) + 1]] <- list(title = "Parentage", chips = list(),
    text = "Each lamb is compared with the genotyped rams and ewes you have submitted. A parent can only be confirmed if it has been genotyped. \"Excluded\" means the recorded parent does not match the lamb's DNA.")
  nxt <- list()
  for (i in which(st$state %in% c("qc", "missing") & !st$replacement)) {
    nxt[[length(nxt) + 1]] <- list(tag = .tag(a[i, ]), text = if (st$state[i] == "qc")
      "take a new TSU from this animal and register it on your results page (Send replacement TSUs). Replacements for failed samples are tested at no charge."
      else paste0("the TSU listed on your form was not in the package. If you still have it, register it on your results page and send it with your reference ", sid, "."))
  }
  contact <- paste0("Questions? MSU Sheep Program \u00b7 ", .clean(s$Contact_Email), " \u00b7 ", .clean(s$Contact_Phone),
                    ". Results relate only to the samples received and tested. An Excel version of this report is available from your results page.")
  list(title = paste(.clean(D$p$Flock_Name), "results"), sub_id = sid,
       contact_line = paste(c(.clean(D$p$Contact_Name), .clean(D$p$Mailing_Address),
                              if (nzchar(.clean(D$p$NSIP_Flock_ID))) paste("NSIP flock", .clean(D$p$NSIP_Flock_ID))), collapse = " \u00b7 "),
       subtitle_right = paste0(n, " ", breed, " submitted ", .fmt_date(D$sub$Submitted_Date), " \u00b7 Report date ", .fmt_date(as.character(Sys.Date()))),
       stats = list(list(label = "Animals submitted", value = n, tone = "none"),
                    list(label = "Results complete", value = sum(st$state == "ok"), tone = "none"),
                    list(label = "Resample needed", value = sum(st$state == "qc"), tone = if (any(st$state == "qc")) "bad" else "none"),
                    list(label = "Sample not received", value = sum(st$state == "missing"), tone = if (any(st$state == "missing")) "mid" else "none")),
       columns = cols, animals = rows, explain = explain, todo = nxt, contact = contact,
       footer_left = paste0("MSU Sheep Genotyping Service \u00b7 ", sid, " \u00b7 ", .clean(D$p$Flock_Name)))
}

.make_pdf <- function(D, file, quarto = QUARTO) {
  tmp <- tempfile("report"); dir.create(tmp)
  on.exit(unlink(tmp, recursive = TRUE), add = TRUE)
  for (f in c("results_template.typ", "logo.svg")) {
    src <- file.path(REPORT_TEMPLATE_DIR, f)
    if (!file.exists(src)) stop("Can't find ", f, " in ", REPORT_TEMPLATE_DIR, ". Keep it next to reports.R.", call. = FALSE)
    file.copy(src, file.path(tmp, f))
  }
  jsonlite::write_json(.pdf_json(D), file.path(tmp, "data.json"), auto_unbox = TRUE, null = "null", pretty = TRUE)
  typ <- file.path(tmp, "results_template.typ")
  out <- suppressWarnings(system2(quarto, c("typst", "compile", shQuote(typ), shQuote(normalizePath(file, mustWork = FALSE))), stdout = TRUE, stderr = TRUE))
  if (!file.exists(file)) stop("Making the PDF failed. Is Quarto installed (quarto --version)?\n", paste(out, collapse = "\n"), call. = FALSE)
  file
}

# ---------------------------------------------------------------------------- Excel
.make_excel <- function(D, file) {
  a <- D$animals; st <- .animal_state(D)
  status <- c(ok = "Complete", qc = "Resample needed", missing = "Sample not received", pending = "Results pending")
  out <- data.frame(`Flock Tag` = .clean(a$Flock_Tag), EID = .clean(a$EID), `NSIP ID` = .clean(a$NSIP_ID), Sex = .clean(a$Sex),
                    `Year of Birth` = .clean(a$Year_of_Birth), Breed = .clean(a$Breed), `TSU Barcode` = .clean(a$TSU_Barcode),
                    Batch = .clean(a$Batch), Status = unname(status[st$state]), check.names = FALSE, stringsAsFactors = FALSE)
  for (i in seq_len(nrow(D$conds))) {
    cid <- D$conds$Condition_ID[i]; nm <- .short(D$conds$Display_Name[i])
    r <- D$res[toupper(D$res$Condition_ID) == toupper(cid), , drop = FALSE]
    m <- match(a$Animal_Key, r$Animal_Key)
    out[[paste(nm, "genotype")]] <- ifelse(is.na(m), "", .clean(r$Genotype[m]))
    out[[paste(nm, "call")]] <- ifelse(is.na(m), "", .clean(r$Call[m]))
    out[[paste(nm, "result")]] <- ifelse(is.na(m), "", .clean(r$Result_Label[m]))
  }
  m <- match(a$Animal_Key, D$par$Animal_Key)
  pv <- function(col) if (col %in% names(D$par)) ifelse(is.na(m), "", .clean(D$par[[col]][m])) else rep("", nrow(a))
  out[["Parentage tested"]] <- ifelse(.clean(a$Test_Parentage) == "N", "No", "Yes")
  out[["Reported sire"]] <- .clean(a$Reported_Sire); out[["Sire result"]] <- pv("Sire_Result"); out[["Sire assigned"]] <- pv("Sire_Assigned")
  out[["Reported dam"]] <- .clean(a$Reported_Dam);   out[["Dam result"]] <- pv("Dam_Result");   out[["Dam assigned"]] <- pv("Dam_Assigned")
  out[["Parentage notes"]] <- pv("Notes")

  wb <- openxlsx::createWorkbook()
  hs <- openxlsx::createStyle(textDecoration = "bold", fgFill = "#F1EEE6", border = "bottom", borderColour = "#CFC9BB", wrapText = TRUE, valign = "center")
  txt <- openxlsx::createStyle(numFmt = "@")
  sid <- D$sub$Submission_ID
  openxlsx::addWorksheet(wb, "Results")
  openxlsx::writeData(wb, "Results", paste0(.clean(D$p$Flock_Name), " \u00b7 ", sid, " \u00b7 report date ", .fmt_date(as.character(Sys.Date()))), startRow = 1)
  openxlsx::addStyle(wb, "Results", openxlsx::createStyle(textDecoration = "bold", fontSize = 13), rows = 1, cols = 1)
  openxlsx::writeData(wb, "Results", out, startRow = 3, headerStyle = hs, keepNA = FALSE)
  openxlsx::addStyle(wb, "Results", txt, rows = 4:(nrow(out) + 3), cols = seq_along(out), gridExpand = TRUE, stack = TRUE)
  openxlsx::setColWidths(wb, "Results", seq_along(out), widths = pmax(10, pmin(24, nchar(names(out)) + 3)))
  openxlsx::setColWidths(wb, "Results", 2:3, widths = 19)
  openxlsx::freezePane(wb, "Results", firstActiveRow = 4, firstActiveCol = 2)
  openxlsx::addFilter(wb, "Results", rows = 3, cols = seq_along(out))
  fills <- c(good = "#DCE8F5", mid = "#FBEBC8", bad = "#F8D7CC")
  for (cid in D$conds$Condition_ID) {
    nm <- .short(D$conds$Display_Name[D$conds$Condition_ID == cid])
    col <- match(paste(nm, "result"), names(out))
    r <- D$res[toupper(D$res$Condition_ID) == toupper(cid), , drop = FALSE]
    cat <- .clean(r$Category[match(a$Animal_Key, r$Animal_Key)])
    for (k in names(fills)) {
      rr <- which(cat == k)
      if (length(rr)) openxlsx::addStyle(wb, "Results", openxlsx::createStyle(fgFill = fills[[k]]), rows = rr + 3, cols = col, stack = TRUE)
    }
  }

  openxlsx::addWorksheet(wb, "How to read")
  w <- "How to read"; row <- 1
  put <- function(x, style = NULL, gap = 1) {
    openxlsx::writeData(wb, w, x, startRow = row, headerStyle = hs, keepNA = FALSE)
    if (!is.null(style)) openxlsx::addStyle(wb, w, style, rows = row, cols = 1)
    row <<- row + (if (is.data.frame(x)) nrow(x) + 1 else length(x)) + gap
  }
  bold <- openxlsx::createStyle(textDecoration = "bold", fontSize = 12)
  put("How to read your results", bold)
  put(data.frame(Condition = D$conds$Display_Name, `Gene or marker` = D$conds$Gene_Marker, `What it means` = D$conds$Explanation, check.names = FALSE))
  put("Result for each call", bold, 0)
  k <- D$key[toupper(D$key$Condition_ID) %in% toupper(D$conds$Condition_ID), , drop = FALSE]
  put(data.frame(Condition = D$conds$Display_Name[match(toupper(k$Condition_ID), toupper(D$conds$Condition_ID))],
                 Call = k$Call, Result = k$Result_Label, Meaning = k$Meaning, check.names = FALSE))
  put("Parentage", bold, 0)
  put(data.frame(Result = c("Confirmed", "Excluded", "Not genotyped", "Pending", "Not requested"),
                 Meaning = c("The recorded parent's DNA matches the lamb.",
                             "The recorded parent does not match the lamb's DNA. \"Assigned\" names a genotyped animal that does match, if one was found.",
                             "The recorded parent has not been genotyped, so it couldn't be checked. Send a sample from it to check parentage.",
                             "Waiting on a sample (for example a replacement TSU).",
                             "Parentage was not requested for this animal.")))
  put("Status", bold, 0)
  put(data.frame(Status = unname(status), Meaning = c("Results are in.", "The TSU failed the lab quality check. A replacement TSU is tested free: register it on your results page.",
                                               "The TSU was on your form but not in the package we received.", "Still being processed.")))
  put(paste0("Questions? MSU Sheep Program \u00b7 ", .clean(D$s$Contact_Email), " \u00b7 ", .clean(D$s$Contact_Phone)))
  openxlsx::setColWidths(wb, w, 1:4, widths = c(28, 22, 80, 60))
  openxlsx::addStyle(wb, w, openxlsx::createStyle(wrapText = TRUE, valign = "top"), rows = 1:row, cols = 1:4, gridExpand = TRUE, stack = TRUE)
  openxlsx::saveWorkbook(wb, file, overwrite = TRUE)
  file
}

# ---------------------------------------------------------------------------- main
.safe_name <- function(x) gsub("_+", "_", gsub("[^A-Za-z0-9]+", "_", x))

#' Make the PDF and Excel results files for one submission, save them in its Drive folder,
#' and link them on the tracker. Returns the local file paths (invisibly).
results_report <- function(submission_id, ss = TRACKER_ID, out_dir = REPORT_DIR, upload = TRUE, pdf = TRUE, quarto = QUARTO) {
  sid <- toupper(.clean(submission_id))
  D <- .report_data(sid, ss)
  if (!nrow(D$res)) warning(sid, " has no results on the tracker yet; the report will show every animal as pending.", call. = FALSE)
  dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
  base <- file.path(out_dir, paste0(sid, "_", .safe_name(.clean(D$p$Flock_Name)), "_results"))
  files <- c(excel = .make_excel(D, paste0(base, ".xlsx")))
  if (pdf) files <- c(pdf = .make_pdf(D, paste0(base, ".pdf"), quarto), files)
  links <- character(0)
  if (upload) {
    folder <- .clean(D$sub$Drive_Folder)
    if (!nzchar(folder)) stop(sid, " has no Drive_Folder on the Submissions tab, so the files were made locally only: ",
                              paste(files, collapse = ", "), call. = FALSE)
    subs <- .tracker_io$read(ss, "Submissions")
    r <- match(sid, subs$Submission_ID) + 1
    for (k in names(files)) {
      links[k] <- .tracker_io$upload(files[[k]], folder)
      .write_cells(ss, "Submissions", names(subs), if (k == "pdf") "Results_PDF" else "Results_Excel", r, links[[k]])
    }
  }
  cat(sid, ": ", paste(basename(files), collapse = ", "), if (upload) " saved to Drive and linked on the tracker" else " (not uploaded)", "\n", sep = "")
  invisible(list(files = files, links = links))
}

#' Results files for several submissions: every submission with an animal in `batch`, or the IDs given.
results_reports <- function(batch = NULL, submissions = NULL, ss = TRACKER_ID, ...) {
  if (is.null(submissions)) {
    if (is.null(batch)) stop("Give a batch (e.g. \"B2026-01\") or submission IDs.", call. = FALSE)
    a <- .tracker_io$read(ss, "Animals")
    submissions <- unique(a$Submission_ID[a$Batch %in% batch])
    r <- .tracker_io$read(ss, "Replacements")
    submissions <- unique(c(submissions, r$Submission_ID[r$Original_Batch %in% batch | r$New_Batch %in% batch]))
    if (!length(submissions)) stop("No submissions in batch ", paste(batch, collapse = ", "), ".", call. = FALSE)
  }
  out <- lapply(submissions, function(s) tryCatch(results_report(s, ss = ss, ...),
                                                  error = function(e) { message(s, ": ", conditionMessage(e)); NULL }))
  names(out) <- submissions
  invisible(out)
}
