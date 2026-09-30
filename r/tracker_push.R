# =============================================================================
# tracker_push.R
# Send genotype calls and parentage results from R to the MSU Sheep Genotyping
# tracker (Google Sheet), and build candidate-parent lists for parentage.
#
# Needs: install.packages("googlesheets4")
#
# Typical use at the end of a batch:
#   source("tracker_push.R")
#   tracker_auth()                                   # first time opens a browser
#   push_results(calls, failed = c("P003-01-26007")) # condition calls
#   cands <- candidate_parents(lamb_keys)            # pool for your parentage run
#   push_parentage(parentage)                        # sire / dam results
#
# Renaming lab sample IDs (TSU barcodes) to Animal_Keys in PLINK:
#   plink_id_files(batch = "B2026-01", prefix = "B2026-01")  # --update-ids / --update-sex files
#   id_map(batch = "B2026-01", file = "B2026-01_ids.csv")    # the same map as a spreadsheet
#
# Nothing written here is visible to producers: every row goes in with
# Released = "N". Releasing is done from the Genotyping menu in the Sheet.
# =============================================================================

TRACKER_ID    <- "[Google Sheet ID or URL]"   # the tracker Sheet
SERVICE_EMAIL <- "cposbergh@gmail.com"      # the account that owns the Sheet

PARENTAGE_RESULTS <- c("Confirmed", "Excluded", "Not genotyped", "Not requested", "Pending")

tracker_auth <- function(email = SERVICE_EMAIL) {
  googlesheets4::gs4_auth(email = email)
}

# -----------------------------------------------------------------------------
# Sheet access. Kept in one place so it can be swapped out for testing.
# -----------------------------------------------------------------------------
.tracker_io <- new.env()

.tracker_io$read <- function(ss, tab) {
  df <- googlesheets4::read_sheet(ss, sheet = tab, col_types = "c", .name_repair = "minimal")
  df <- as.data.frame(df, stringsAsFactors = FALSE, check.names = FALSE)
  df[is.na(df)] <- ""
  df
}
.tracker_io$append <- function(ss, tab, df) {
  googlesheets4::sheet_append(ss, df, sheet = tab)
}
.tracker_io$write <- function(ss, tab, range, df) {
  googlesheets4::range_write(ss, df, sheet = tab, range = range, col_names = FALSE, reformat = FALSE)
}

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
.col_letter <- function(n) {
  out <- character(0)
  while (n > 0) { r <- (n - 1) %% 26; out <- c(LETTERS[r + 1], out); n <- (n - 1) %/% 26 }
  paste(out, collapse = "")
}

.clean <- function(x) { x <- as.character(x); x[is.na(x)] <- ""; trimws(x) }

.need_cols <- function(df, cols, what) {
  miss <- setdiff(cols, names(df))
  if (length(miss)) stop(what, " is missing column(s): ", paste(miss, collapse = ", "), call. = FALSE)
}

.stop_if_problems <- function(problems, what) {
  if (!length(problems)) return(invisible())
  shown <- head(problems, 25)
  more <- if (length(problems) > 25) paste0("\n  ... and ", length(problems) - 25, " more") else ""
  stop(what, ": nothing was written.\n  ", paste(shown, collapse = "\n  "), more, call. = FALSE)
}

# Order a data frame to match a tab's header; missing columns become "".
.as_sheet_rows <- function(df, header) {
  out <- lapply(header, function(h) if (h %in% names(df)) df[[h]] else rep("", nrow(df)))
  names(out) <- header
  as.data.frame(out, stringsAsFactors = FALSE, check.names = FALSE)
}

# Split sheet row numbers into runs of consecutive rows, so each run is one write.
.runs <- function(rows) {
  rows <- sort(unique(rows))
  if (!length(rows)) return(list())
  split(rows, cumsum(c(1, diff(rows) != 1)))
}

# Write whole rows back in place (row numbers are sheet rows; header is row 1).
.write_rows <- function(ss, tab, sheet_rows, df, header) {
  df <- .as_sheet_rows(df, header)
  ord <- order(sheet_rows); sheet_rows <- sheet_rows[ord]; df <- df[ord, , drop = FALSE]
  for (run in .runs(sheet_rows)) {
    idx <- match(run, sheet_rows)
    .tracker_io$write(ss, tab, paste0("A", run[1]), df[idx, , drop = FALSE])
  }
}

# Write one column's values into given sheet rows, grouped into runs.
.write_cells <- function(ss, tab, header, col, sheet_rows, values) {
  L <- .col_letter(match(col, header))
  ord <- order(sheet_rows); sheet_rows <- sheet_rows[ord]; values <- values[ord]
  for (run in .runs(sheet_rows)) {
    idx <- match(run, sheet_rows)
    .tracker_io$write(ss, tab, paste0(L, run[1]),
                      data.frame(v = values[idx], stringsAsFactors = FALSE))
  }
}

# Insert new rows / replace changed rows / skip identical rows, keyed by `key_cols`.
.upsert <- function(ss, tab, new_df, key_cols, compare_cols, dry_run) {
  existing <- .tracker_io$read(ss, tab)
  header <- names(existing)
  .need_cols(new_df, setdiff(header, "Released"), paste0("Rows for ", tab))
  key_of <- function(d) do.call(paste, c(lapply(key_cols, function(k) .clean(d[[k]])), sep = "|"))
  ek <- key_of(existing); nk <- key_of(new_df)
  pos <- match(nk, ek)
  is_new <- is.na(pos)
  same <- rep(FALSE, length(nk))
  if (any(!is_new)) {
    old <- existing[pos[!is_new], compare_cols, drop = FALSE]
    now <- new_df[!is_new, compare_cols, drop = FALSE]
    same[!is_new] <- apply(.clean_df(old) == .clean_df(now), 1, all)
  }
  changed <- !is_new & !same
  was_released <- rep(FALSE, length(nk))
  if ("Released" %in% header) was_released[changed] <- .clean(existing$Released[pos[changed]]) == "Y"
  new_df$Released <- "N"
  if (!dry_run) {
    if (any(is_new))  .tracker_io$append(ss, tab, .as_sheet_rows(new_df[is_new, , drop = FALSE], header))
    if (any(changed)) .write_rows(ss, tab, pos[changed] + 1, new_df[changed, , drop = FALSE], header)
  }
  list(added = sum(is_new), replaced = sum(changed), unchanged = sum(same),
       replaced_released = nk[changed & was_released])
}
.clean_df <- function(d) { d[] <- lapply(d, .clean); as.matrix(d) }

.year <- function(x) suppressWarnings(as.integer(substr(.clean(x), 1, 4)))

# Set Submissions Status to "Analyzing" for submissions still before that stage.
.mark_analyzing <- function(ss, subs, dry_run) {
  s <- .tracker_io$read(ss, "Submissions")
  hit <- which(s$Submission_ID %in% subs & s$Status %in% c("Submitted", "Received", "At lab", ""))
  if (length(hit) && !dry_run)
    .write_cells(ss, "Submissions", names(s), "Status", hit + 1, rep("Analyzing", length(hit)))
  s$Submission_ID[hit]
}

# -----------------------------------------------------------------------------
# push_results(): condition calls -> Results tab
#   calls: data frame with Animal_Key, Condition_ID, Genotype, Call
#          (optional Run_Date; otherwise run_date is used)
#   failed: Animal_Keys whose TSU failed the lab quality check
# -----------------------------------------------------------------------------
push_results <- function(calls, ss = TRACKER_ID, run_date = Sys.Date(), failed = character(), dry_run = FALSE) {
  .need_cols(calls, c("Animal_Key", "Condition_ID", "Genotype", "Call"), "calls")
  calls <- data.frame(Animal_Key = .clean(calls$Animal_Key), Condition_ID = toupper(.clean(calls$Condition_ID)),
                      Genotype = .clean(calls$Genotype), Call = .clean(calls$Call),
                      Run_Date = if ("Run_Date" %in% names(calls)) as.character(calls$Run_Date) else as.character(run_date),
                      stringsAsFactors = FALSE)
  failed <- .clean(failed)

  animals <- .tracker_io$read(ss, "Animals")
  key     <- .tracker_io$read(ss, "Result_Key")
  conds   <- .tracker_io$read(ss, "Conditions")

  # ---- check everything before writing anything
  problems <- character(0)
  dup <- duplicated(paste(calls$Animal_Key, calls$Condition_ID))
  if (any(dup)) problems <- c(problems, paste0("Listed twice: ", calls$Animal_Key[dup], " ", calls$Condition_ID[dup]))
  bad_animal <- unique(c(calls$Animal_Key, failed)[!c(calls$Animal_Key, failed) %in% animals$Animal_Key])
  if (length(bad_animal)) problems <- c(problems, paste0("Not on the Animals tab: ", bad_animal))
  bad_cond <- unique(calls$Condition_ID[!calls$Condition_ID %in% toupper(conds$Condition_ID)])
  if (length(bad_cond)) problems <- c(problems, paste0("Not on the Conditions tab: ", bad_cond))
  kk <- paste(toupper(key$Condition_ID), key$Call, sep = "|")
  ck <- paste(calls$Condition_ID, calls$Call, sep = "|")
  bad_call <- which(!ck %in% kk & calls$Condition_ID %in% toupper(conds$Condition_ID))
  if (length(bad_call)) problems <- c(problems, paste0("Call not in Result_Key: ", calls$Animal_Key[bad_call], " ",
                                                      calls$Condition_ID[bad_call], " = '", calls$Call[bad_call], "'"))
  both <- intersect(failed, calls$Animal_Key)
  if (length(both)) problems <- c(problems, paste0("Has calls but is also listed as failed: ", both))
  .stop_if_problems(problems, "push_results() found problems")

  if (length(failed)) {
    had <- intersect(failed, .tracker_io$read(ss, "Results")$Animal_Key)
    if (length(had)) warning("Marked Failed QC but already have rows on Results (left in place): ",
                             paste(had, collapse = ", "), call. = FALSE)
  }

  # ---- build full rows
  a <- match(calls$Animal_Key, animals$Animal_Key)
  k <- match(ck, kk)
  rows <- data.frame(Animal_Key = calls$Animal_Key, Submission_ID = animals$Submission_ID[a],
                     Condition_ID = calls$Condition_ID, Genotype = calls$Genotype, Call = calls$Call,
                     Result_Label = key$Result_Label[k], Category = key$Category[k], Batch = animals$Batch[a],
                     Run_Date = as.Date(calls$Run_Date), stringsAsFactors = FALSE)   # a real date in the Sheet
  res <- .upsert(ss, "Results", rows, c("Animal_Key", "Condition_ID"), c("Genotype", "Call"), dry_run)

  # ---- newly genotyped animals become candidate parents for their flock
  cp <- .tracker_io$read(ss, "Candidate_Parents")
  subs <- .tracker_io$read(ss, "Submissions")
  newk <- setdiff(unique(calls$Animal_Key), cp$Animal_Key)
  if (length(newk)) {
    ai <- match(newk, animals$Animal_Key)
    si <- match(animals$Submission_ID[ai], subs$Submission_ID)
    cand <- data.frame(Producer_ID = subs$Producer_ID[si], Animal_Key = newk, Flock_Tag = animals$Flock_Tag[ai],
                       EID = animals$EID[ai], NSIP_ID = animals$NSIP_ID[ai], Sex = animals$Sex[ai],
                       Year_of_Birth = animals$Year_of_Birth[ai], Genotyped_In = animals$Submission_ID[ai],
                       Active = "Y", Notes = "", stringsAsFactors = FALSE)
    if (!dry_run) .tracker_io$append(ss, "Candidate_Parents", .as_sheet_rows(cand, names(cp)))
  }

  # ---- sample status on Animals
  want <- c(setNames(rep("Complete", length(unique(calls$Animal_Key))), unique(calls$Animal_Key)),
            setNames(rep("Failed QC", length(failed)), failed))
  ri <- match(names(want), animals$Animal_Key)
  change <- animals$Sample_Status[ri] != want
  if (any(change) && !dry_run)
    .write_cells(ss, "Animals", names(animals), "Sample_Status", ri[change] + 1, unname(want[change]))

  analyzing <- .mark_analyzing(ss, unique(animals$Submission_ID[match(c(calls$Animal_Key, failed), animals$Animal_Key)]), dry_run)

  summary <- list(results_added = res$added, results_replaced = res$replaced, results_unchanged = res$unchanged,
                  released_rows_changed = res$replaced_released, candidate_parents_added = length(newk),
                  samples_updated = sum(change), failed_qc = length(failed), set_to_analyzing = analyzing, dry_run = dry_run)
  .report("push_results", summary)
  invisible(summary)
}

# -----------------------------------------------------------------------------
# push_parentage(): sire/dam results -> Parentage tab
#   par: data frame with Animal_Key, Sire_Result, Dam_Result
#        (optional Sire_Assigned, Dam_Assigned, Notes)
#   Result values: Confirmed, Excluded, Not genotyped, Not requested, Pending
# -----------------------------------------------------------------------------
push_parentage <- function(par, ss = TRACKER_ID, dry_run = FALSE) {
  .need_cols(par, c("Animal_Key", "Sire_Result", "Dam_Result"), "par")
  get <- function(col) if (col %in% names(par)) .clean(par[[col]]) else rep("", nrow(par))
  par <- data.frame(Animal_Key = get("Animal_Key"), Sire_Result = get("Sire_Result"), Sire_Assigned = get("Sire_Assigned"),
                    Dam_Result = get("Dam_Result"), Dam_Assigned = get("Dam_Assigned"), Notes = get("Notes"),
                    stringsAsFactors = FALSE)

  animals <- .tracker_io$read(ss, "Animals")
  cp      <- .tracker_io$read(ss, "Candidate_Parents")

  problems <- character(0)
  dup <- duplicated(par$Animal_Key)
  if (any(dup)) problems <- c(problems, paste0("Listed twice: ", par$Animal_Key[dup]))
  bad <- unique(par$Animal_Key[!par$Animal_Key %in% animals$Animal_Key])
  if (length(bad)) problems <- c(problems, paste0("Not on the Animals tab: ", bad))
  for (col in c("Sire_Result", "Dam_Result")) {
    b <- which(!par[[col]] %in% PARENTAGE_RESULTS)
    if (length(b)) problems <- c(problems, paste0(col, " not one of ", paste(PARENTAGE_RESULTS, collapse = "/"),
                                                  ": ", par$Animal_Key[b], " = '", par[[col]][b], "'"))
  }
  .stop_if_problems(problems, "push_parentage() found problems")

  # assigned parents should be genotyped animals; warn (not stop) if not found
  known <- c(cp$Animal_Key, cp$Flock_Tag, cp$EID, cp$NSIP_ID)
  for (col in c("Sire_Assigned", "Dam_Assigned")) {
    odd <- par[[col]] != "" & !par[[col]] %in% known
    if (any(odd)) warning(col, " not found on Candidate_Parents for: ",
                          paste(par$Animal_Key[odd], collapse = ", "), call. = FALSE)
  }

  a <- match(par$Animal_Key, animals$Animal_Key)
  rows <- data.frame(Animal_Key = par$Animal_Key, Submission_ID = animals$Submission_ID[a],
                     Reported_Sire = animals$Reported_Sire[a], Sire_Result = par$Sire_Result, Sire_Assigned = par$Sire_Assigned,
                     Reported_Dam = animals$Reported_Dam[a], Dam_Result = par$Dam_Result, Dam_Assigned = par$Dam_Assigned,
                     Notes = par$Notes, stringsAsFactors = FALSE)
  res <- .upsert(ss, "Parentage", rows, "Animal_Key",
                 c("Sire_Result", "Sire_Assigned", "Dam_Result", "Dam_Assigned", "Notes"), dry_run)
  analyzing <- .mark_analyzing(ss, unique(rows$Submission_ID), dry_run)

  summary <- list(parentage_added = res$added, parentage_replaced = res$replaced, parentage_unchanged = res$unchanged,
                  released_rows_changed = res$replaced_released, set_to_analyzing = analyzing, dry_run = dry_run)
  .report("push_parentage", summary)
  invisible(summary)
}

# -----------------------------------------------------------------------------
# candidate_parents(): candidate sires and dams for each lamb
#   For each lamb: that flock's Active = "Y" animals of the right sex born
#   before the lamb, plus its reported sire/dam if genotyped (even if inactive).
#   Returns one row per lamb x candidate:
#   Lamb_Key, Parent_Role, Candidate_Key, Candidate_Tag, Candidate_NSIP_ID, Reported
# -----------------------------------------------------------------------------
candidate_parents <- function(lamb_keys, ss = TRACKER_ID) {
  animals <- .tracker_io$read(ss, "Animals")
  cp      <- .tracker_io$read(ss, "Candidate_Parents")
  subs    <- .tracker_io$read(ss, "Submissions")
  lamb_keys <- .clean(lamb_keys)
  bad <- setdiff(lamb_keys, animals$Animal_Key)
  .stop_if_problems(if (length(bad)) paste0("Not on the Animals tab: ", bad) else character(0), "candidate_parents()")

  cp_year <- .year(cp$Year_of_Birth)
  out <- list()
  for (lk in lamb_keys) {
    a <- animals[match(lk, animals$Animal_Key), ]
    prod <- subs$Producer_ID[match(a$Submission_ID, subs$Submission_ID)]
    ly <- .year(a$Year_of_Birth)
    flock <- cp$Producer_ID == prod & cp$Animal_Key != lk
    older <- if (is.na(ly)) rep(TRUE, nrow(cp)) else (!is.na(cp_year) & cp_year < ly)
    for (role in c("Sire", "Dam")) {
      sex <- if (role == "Sire") "M" else "F"
      reported <- .clean(a[[paste0("Reported_", role)]])
      is_rep <- reported != "" & flock & (cp$Flock_Tag == reported | cp$EID == reported | cp$NSIP_ID == reported)
      pick <- (flock & cp$Active == "Y" & cp$Sex == sex & older) | is_rep
      if (any(pick))
        out[[length(out) + 1]] <- data.frame(Lamb_Key = lk, Parent_Role = role, Candidate_Key = cp$Animal_Key[pick],
                                             Candidate_Tag = cp$Flock_Tag[pick], Candidate_NSIP_ID = cp$NSIP_ID[pick],
                                             Reported = is_rep[pick], stringsAsFactors = FALSE)
    }
  }
  if (!length(out)) return(data.frame(Lamb_Key = character(), Parent_Role = character(), Candidate_Key = character(),
                                      Candidate_Tag = character(), Candidate_NSIP_ID = character(), Reported = logical()))
  do.call(rbind, out)
}

# -----------------------------------------------------------------------------
# animal_key(): the tracker's rule for Animal_Key (the Apps Script uses the same)
#   Submission_ID + "-" + flock tag, or + EID when there is no flock tag.
# -----------------------------------------------------------------------------
animal_key <- function(submission_id, flock_tag, eid) {
  tag <- .clean(flock_tag); eid <- .clean(eid)
  ifelse(tag != "", paste0(.clean(submission_id), "-", tag),
         ifelse(eid != "", paste0(.clean(submission_id), "-", eid), NA_character_))
}

# -----------------------------------------------------------------------------
# id_map(): TSU barcode <-> Animal_Key for animals sent to the lab
#   batch: one or more Batch IDs (default: every animal with a batch)
#   file:  optional .csv path to save it
# -----------------------------------------------------------------------------
id_map <- function(batch = NULL, ss = TRACKER_ID, file = NULL) {
  animals <- .tracker_io$read(ss, "Animals")
  subs    <- .tracker_io$read(ss, "Submissions")
  keep <- animals$Batch != "" & animals$TSU_Barcode != ""
  if (!is.null(batch)) {
    miss <- setdiff(batch, animals$Batch)
    if (length(miss)) warning("No animals in batch: ", paste(miss, collapse = ", "), call. = FALSE)
    keep <- keep & animals$Batch %in% batch
  }
  a <- animals[keep, , drop = FALSE]
  out <- data.frame(Batch = a$Batch, TSU_Barcode = a$TSU_Barcode, Animal_Key = a$Animal_Key,
                    Submission_ID = a$Submission_ID, Producer_ID = subs$Producer_ID[match(a$Submission_ID, subs$Submission_ID)],
                    Flock_Tag = a$Flock_Tag, EID = a$EID, NSIP_ID = a$NSIP_ID, Sex = a$Sex,
                    Year_of_Birth = a$Year_of_Birth, Sample_Status = a$Sample_Status, stringsAsFactors = FALSE)
  dup <- out$TSU_Barcode[duplicated(out$TSU_Barcode)]
  if (length(dup)) warning("TSU barcode used more than once: ", paste(unique(dup), collapse = ", "), call. = FALSE)
  if (!is.null(file)) utils::write.csv(out, file, row.names = FALSE)
  out
}

# -----------------------------------------------------------------------------
# plink_id_files(): files for plink --update-ids and --update-sex
#   Renames lab sample IDs (TSU barcodes) to Animal_Keys.
#   old_fid: the FID in the lab's .fam: "iid" (same as the TSU), or a fixed value such as "0"
#   new_fid: "producer" (P003), "submission" (P003-01) or "same" (= new IID)
#   Writes <prefix>_update_ids.txt and <prefix>_update_sex.txt, no header,
#   ready for:  plink --bfile lab --update-ids X_update_ids.txt --make-bed --out renamed
#               plink --bfile renamed --update-sex X_update_sex.txt --make-bed --out final
#   (--update-sex uses the new IDs, so run it after --update-ids.)
# -----------------------------------------------------------------------------
plink_id_files <- function(batch = NULL, prefix = "plink", old_fid = "iid", new_fid = "producer", ss = TRACKER_ID) {
  m <- id_map(batch, ss = ss)
  if (!nrow(m)) stop("No animals with a batch and TSU barcode to write.", call. = FALSE)
  new_fid <- match.arg(new_fid, c("producer", "submission", "same"))
  nfid <- switch(new_fid, producer = m$Producer_ID, submission = m$Submission_ID, same = m$Animal_Key)
  ofid <- if (identical(old_fid, "iid")) m$TSU_Barcode else rep(as.character(old_fid), nrow(m))
  ids <- data.frame(ofid, m$TSU_Barcode, nfid, m$Animal_Key, stringsAsFactors = FALSE)
  spaced <- apply(ids, 1, function(r) any(grepl("\\s", r)))
  if (any(spaced)) {
    warning("Spaces replaced with _ in IDs for: ", paste(m$Animal_Key[spaced], collapse = ", "), call. = FALSE)
    ids[] <- lapply(ids, function(x) gsub("\\s+", "_", x))
  }
  sex <- data.frame(ids[[3]], ids[[4]], ifelse(m$Sex == "M", 1L, ifelse(m$Sex == "F", 2L, 0L)), stringsAsFactors = FALSE)
  f_ids <- paste0(prefix, "_update_ids.txt"); f_sex <- paste0(prefix, "_update_sex.txt")
  utils::write.table(ids, f_ids, quote = FALSE, row.names = FALSE, col.names = FALSE, sep = "\t")
  utils::write.table(sex, f_sex, quote = FALSE, row.names = FALSE, col.names = FALSE, sep = "\t")
  cat(sprintf("Wrote %s and %s (%d animals)\n", f_ids, f_sex, nrow(m)))
  invisible(list(update_ids = f_ids, update_sex = f_sex, map = m))
}

.report <- function(fn, s) {
  cat(if (isTRUE(s$dry_run)) paste0(fn, " (dry run, nothing written)\n") else paste0(fn, "\n"))
  for (n in setdiff(names(s), c("dry_run", "released_rows_changed", "set_to_analyzing")))
    cat(sprintf("  %-26s %s\n", n, s[[n]]))
  if (length(s$set_to_analyzing)) cat("  Status set to Analyzing:   ", paste(s$set_to_analyzing, collapse = ", "), "\n")
  if (length(s$released_rows_changed))
    cat("  NOTE: these rows were already released and changed; set back to Released = N for review:\n    ",
        paste(s$released_rows_changed, collapse = ", "), "\n")
}
