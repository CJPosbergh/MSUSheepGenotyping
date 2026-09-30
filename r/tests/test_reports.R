# Checks reports.R and tracker_push.R against the example tracker, with the Google Sheet and Drive
# replaced by a local copy. Run from the repo root:  Rscript r/tests/test_reports.R
# Needs openxlsx and jsonlite, plus Quarto for the PDF (skipped with a note if Quarto is missing).
suppressWarnings(source("r/tracker_push.R"))
source("r/reports.R")
REPORT_TEMPLATE_DIR <- "r"

xlsx <- "tracker/MSU_Sheep_Genotyping_Tracker_EXAMPLE.xlsx"
mem <- new.env()
for (tab in openxlsx::getSheetNames(xlsx)) {
  df <- openxlsx::read.xlsx(xlsx, sheet = tab, check.names = FALSE, sep.names = "_", skipEmptyRows = TRUE)
  for (k in grep("_Date$", names(df))) if (is.numeric(df[[k]])) df[[k]] <- as.character(openxlsx::convertToDate(df[[k]]))
  df[] <- lapply(df, function(x) { x <- as.character(x); x[is.na(x)] <- ""; x })
  mem[[tab]] <- df
}
uploads <- character(0)
.tracker_io$read <- function(ss, tab) mem[[tab]]
.tracker_io$write <- function(ss, tab, range, df) {
  col <- sub("[0-9]+$", "", range); row <- as.integer(sub("^[A-Z]+", "", range)) - 1
  ci <- 0; for (ch in strsplit(col, "")[[1]]) ci <- ci * 26 + match(ch, LETTERS)
  for (j in seq_along(df)) mem[[tab]][row + seq_len(nrow(df)) - 1, ci + j - 1] <- as.character(df[[j]])
}
.tracker_io$append <- function(ss, tab, df) { df[] <- lapply(df, as.character); mem[[tab]] <- rbind(mem[[tab]], df) }
.tracker_io$upload <- function(path, folder_url) { uploads <<- c(uploads, basename(path)); paste0("https://drive.google.com/file/d/TEST", length(uploads), "xxxxxxxxxxxxxxxxxxxx/view") }

n <- 0
ok <- function(cond, msg) { if (!isTRUE(cond)) stop("FAILED: ", msg, call. = FALSE); n <<- n + 1; cat("  \u2713", msg, "\n") }

out <- file.path(tempdir(), "reports"); dir.create(out, showWarnings = FALSE)
have_quarto <- nzchar(Sys.which(QUARTO))
mem$Submissions$Drive_Folder[mem$Submissions$Submission_ID == "P003-01"] <- "https://drive.google.com/drive/folders/FOLDERxxxxxxxxxxxxxxxxxxxx"

cat("Results files for P003-01\n")
r <- results_report("P003-01", ss = "test", out_dir = out, pdf = have_quarto)
ok(file.exists(r$files[["excel"]]), "Excel file made")
wb <- openxlsx::loadWorkbook(r$files[["excel"]])
ok(identical(openxlsx::sheets(wb), c("Results", "How to read")), "two sheets: Results and How to read")
x <- openxlsx::read.xlsx(r$files[["excel"]], sheet = "Results", startRow = 3, check.names = FALSE, sep.names = " ")
ok(nrow(x) == 12, "one row per animal (12)")
ok(x$EID[1] == "840003307100001", "EID kept as full 15-digit text")
ok(x[["Scrapie result"]][x[["Flock Tag"]] == "26001"] == "Carries Q" && x[["OPP genotype"]][x[["Flock Tag"]] == "26002"] == "2/3", "condition columns filled")
ok(x$Status[x[["Flock Tag"]] == "26007"] == "Resample needed", "failed sample shows Resample needed")
ok(x[["Sire result"]][x[["Flock Tag"]] == "26009"] == "Excluded", "parentage columns filled")
h <- openxlsx::read.xlsx(r$files[["excel"]], sheet = "How to read", colNames = FALSE)
ok(any(grepl("Scrapie susceptibility", h[[1]])) && any(grepl("Excluded", unlist(h))), "How to read explains conditions and parentage")
j <- .pdf_json(.report_data("P003-01", "test"))
ok(j$stats[[3]]$value == 1 && j$stats[[4]]$value == 1, "PDF summary: 1 resample, 1 not received")
ok(length(j$columns) == 2 && j$columns[[1]]$head == "Scrapie \u00b7 PRNP", "PDF columns: active conditions only")
a1 <- j$animals[[1]]
ok(a1$cells[[1]]$label == "QR \u00b7 Carries Q" && a1$parent$main == "Sire confirmed: 23015", "PDF row: chip text and parentage")
if (have_quarto) {
  ok(file.exists(r$files[["pdf"]]) && file.size(r$files[["pdf"]]) > 10000, paste("PDF made with Quarto/Typst:", basename(r$files[["pdf"]])))
  invisible(file.copy(r$files[["pdf"]], "tests/out/", overwrite = TRUE))
} else cat("  (Quarto not found: PDF not tested)\n")
s <- mem$Submissions[mem$Submissions$Submission_ID == "P003-01", ]
ok(grepl("^https://drive.google.com/file/d/", s$Results_Excel) && (!have_quarto || grepl("drive", s$Results_PDF)), "links written to Results_PDF / Results_Excel")
ok(length(uploads) == if (have_quarto) 2 else 1, "files uploaded to the submission folder")

cat("Local only, and by batch\n")
mem$Submissions$Drive_Folder[mem$Submissions$Submission_ID == "P002-01"] <- ""
e <- tryCatch(results_report("P002-01", ss = "test", out_dir = out, pdf = FALSE), error = function(e) conditionMessage(e))
ok(is.character(e) && grepl("no Drive_Folder", e), "missing Drive folder: clear message, files kept locally")
r2 <- suppressWarnings(results_report("P002-01", ss = "test", out_dir = out, pdf = FALSE, upload = FALSE))
ok(file.exists(r2$files[["excel"]]), "upload = FALSE just makes the files")
res <- suppressMessages(results_reports(batch = "B2026-02", ss = "test", out_dir = out, pdf = FALSE, upload = FALSE))
ok(setequal(names(res), c("P002-01", "P003-01")), "results_reports(batch) finds every submission in the batch")
e <- tryCatch(results_report("P999-01", ss = "test"), error = function(e) conditionMessage(e))
ok(grepl("No submission P999-01", e), "unknown submission refused")
if (file.exists("tests/out")) invisible(file.copy(r$files[["excel"]], "tests/out/", overwrite = TRUE))
cat("\nAll", n, "R checks passed.\n")
