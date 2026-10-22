# Lyrics Presentation

Browser-based lyrics presentation software (HTML + CSS + JavaScript modules + JSON config). Songs come from a Google Sheet, with `songs.json` as a fallback.

## Run

Start it with the script for your system. Each one finds Python, starts the server on http://127.0.0.1:8000 (localhost only) and opens the app in your browser. If the server is already running it just opens the browser.

| System | How |
|---|---|
| Windows | Double-click **`start.bat`** |
| macOS | Double-click **`start.command`** (or run `./start.sh`). If macOS blocks it, right-click, Open |
| Linux | Run `./start.sh` in a terminal |

On macOS and Linux the scripts may need to be made executable once: `chmod +x start.sh start.command`. Use another port with `PORT=8080 ./start.sh`. The server stops by itself a few seconds after the presentation page (`index.html`) is closed; closing the output window does not stop it. You can also close the terminal window or press Ctrl+C.

To start it manually instead: browsers block ES modules and `fetch` on `file://`, so serve the folder locally, bound to localhost only:

```
py -m http.server 8000 --bind 127.0.0.1
```

Open http://127.0.0.1:8000/index.html, then click **Open output window** and drag that window to the projector/second screen. Double-click it (or press `F`) for fullscreen.

## Song Library (Google Sheet or Local Library)

1. Open **Settings** via the hamburger menu (three lines, top right).
2. Choose **Song library source**:
   - **Google Sheet**:
     - Row 1 must contain headers: `title`, `lyrics`, and optionally `author` (names configurable in `config.json`).
     - Put one song per row (leave an empty line between verses in the `lyrics` cell for new slides).
     - Share sheet as **Anyone with the link can view**.
     - Paste the sheet URL or ID in Settings and click **Save settings**.
   - **Local Song Library (JSON/CSV)**:
     - Click **Import local songs** and pick a local `.json`, `.csv`, or `.txt` file containing your songs.
     - Supports JSON (`{ "songs": [ { "title": "...", "lyrics": "..." } ] }`) and CSV (`title,lyrics,author`).
     - Or click **Load default songs.json** to use the local fallback file.

Each song starts with a title slide (song title, with the author underneath if set). Turn it off with **Title slide at start of each song** in Settings, or `"showTitle": false` in `config.json`.



## Files

| File | Purpose |
|---|---|
| `index.html` | Operator console |
| `output.html` | Audience screen (receives slides via `BroadcastChannel`) |
| `styles.css` | All styling and screen themes |
| `app.js` | Sheet loading, slide splitting, controls |
| `screen.js` | Shared slide renderer (text, pictures, video) |
| `media.js` | Browser storage (IndexedDB) for videos and PowerPoint pictures |
| `pptx.js` | PowerPoint (.pptx/.ppsx) reader |
| `drive.js` | Google Drive folder listing and MP3 download |
| `config.json` | Sheet ID/columns and default theme |
| `songs.json` | Offline fallback songs |

## Custom slides

Open **Custom slide** under the **Library** and type your own text (a blank line starts a new slide).

- **Show now** puts it on screen immediately. Nothing is saved.
- **Save to library** stores it in the library next to the songs, marked "Custom slide". There you can show it, edit it (pencil), delete it (×), or add it to the set list with **+**.
- **Background image:** choose a JPG, PNG, WebP or GIF file under the text. It is scaled down (max 1600 px) and stored as a JPEG inside the slide, so it works offline and appears on the output window. Use the **Darken image** slider to keep the text readable. The text can be left empty for an image-only slide. **Remove image** clears it.
- Custom slides have no title slide and are stored in browser localStorage, like the set list. Browsers limit localStorage to roughly 5 MB, so expect room for about 10 to 20 images; the app tells you if saving fails.

## Video and PowerPoint

In the **Custom slide** editor, use the **Video or PowerPoint** file picker.

**Video** (MP4/H.264 is the safest choice; WebM, Ogg and MOV work if your browser can play them; up to 2 GB)
- The video becomes one slide. Any text you type is drawn over it.
- Under the preview, **Pause/Play** and **Restart** control it. Keys: `K` pause/play, `S` restart.
- Pressing `.` (blank) pauses the video and hides it; un-blanking resumes it.
- Video sound plays from the **operator window** (the preview), not the output window. Browsers block sound in a window nobody has clicked, so the output window is always silent and needs no click. Use the computer's speakers, or make sure the sound goes to the same device as the projector. The preview is muted while **Live** is off. Sound and picture are two separate players, so they can drift apart slightly. Tick **Mute** in the editor for silent clips.

**PowerPoint** (`.pptx` or `.ppsx`, up to 200 MB and 300 slides)
- Click **+ PowerPoint** in the Library header (or choose a `.pptx` file under Custom slide).
- Slides are automatically rendered and exported as full-resolution images (preserving all formatting, shapes, fonts, and backgrounds) and added directly to your Set List and Library.
- Old `.ppt` files are not supported; in PowerPoint use *Save As* and choose `.pptx`. Password-protected files are rejected.

Videos and pictures are stored in the browser (IndexedDB), not in the set list or in localStorage, so they are only available in the browser and on the computer where you imported them. Clearing site data removes them. If the browser's storage is full you will see a message. Files that are no longer used by any custom slide are removed automatically.


## Audio Library (Local Audio or Google Drive)

The **Audio library** box (under the Audio set list) lets you browse and add audio tracks to the Audio set list. Press **+** (or double-click) to add a track to the set list, then click it there to play. Audio plays on the operator computer's speakers.

In **Settings** (hamburger menu), select your **Audio source**:

### Option A: Local Audio Library (Offline)
- Choose **Local Audio Library** under Audio source.
- Select a local music folder (via folder picker) or individual audio files (MP3, WAV, OGG, M4A, FLAC).
- Tracks and folder hierarchy are stored locally in the browser (IndexedDB) and remain available offline.

### Option B: Google Drive Audio (Cloud)
- Choose **Google Drive** under Audio source.
- Share your Google Drive folder as **Anyone with the link can view**.
- In Settings, enter your **Google Drive folder URL** and **Google API key** (with Google Drive API enabled).

- **Search this folder** filters the files and folders you are looking at as you type (not case sensitive). It clears when you open a folder or go back.
- **Audio set list:** use the up/down/x buttons to reorder or remove tracks, **Track** buttons to jump to the previous/next one, and the player to pause or seek. A track plays once and then stops; the next one never starts by itself. Pick it yourself. The list is saved in this browser, and removing the track that is playing does not stop it. Each track is downloaded when it starts playing.
- Click a folder to open it, **Back** to go up, **Refresh** to reload the listing. Only folders and `.mp3` files are shown (up to 1000 entries per folder).
- Files up to 150 MB are supported and played from memory, so a long track can take a moment to start.
- The key is stored only in this browser's localStorage, like the ESV key; it is not written to `config.json` or any file, and it is sent to Google in a request header rather than in the address.

## Bible verses (ESV)

1. Get a free API key at https://api.esv.org/ (create an account, then an application). Paste it into **Settings → ESV API key** and press **Save settings**. The key is stored only in this browser's localStorage; it is not written to `config.json` or any file.
2. Open **ESV Bible verses** under the **Library**, type a reference (e.g. `John 3:16-18`, `Psalm 23`, `Romans 8:1-4; 12:1-2`), choose how many verses go on each slide, and press **Fetch** (or Enter).
3. Check the preview, then use **Show now**, **Save to library**, or **Add to set list** (this also saves it to the library). Saved passages appear in the library as "Bible (ESV)" and can be edited like other custom slides, and fetching the same reference again replaces the saved copy.

Each slide ends with the reference and "(ESV)". Passages are saved locally, so they still work offline once saved. The ESV text is subject to Crossway's API terms and copyright rules; check them for how much you may store and display.


## Set list

- Press **+** next to a song to add it to the set list (the middle column). The same song can be added more than once.
- Use the **↑ / ↓ / ×** buttons to reorder or remove entries. Click an entry to show that song.
- The output window follows the set list only: clicking an item in the library does not change the output. Add songs with **+** or by double-clicking them, then click them in the set list to display them. (The **Show now** buttons in the custom slide and Bible editors are explicit exceptions: they display immediately.)
- Pressing next on the last slide of a set list song moves to the first slide of the next song; pressing previous on a first slide goes back to the previous song's last slide.
- **Export** downloads `setlist.json`; **Import** loads one. Entries are matched to songs by title and author, so a song renamed in the sheet shows as "(not found)" and is skipped.
- The set list is saved in browser localStorage.

## Layout

Three columns, separated by draggable borders: drag a border left or right to resize the columns (double-click it to reset, or focus it and use the arrow keys, Shift for bigger steps, Home to reset). Sizes are remembered in this browser. The columns are: the **Library** (songs, with the **Custom slide** and **Bible verses** editors underneath) on the left, the **Set list** (with the **Audio set list** and the **Google Drive audio** browser underneath) in the middle, and the controls, preview and slide list for the current song on the right.

## Settings

Settings are hidden in a drawer. Click the burger button (three lines) at the top right to open it; close it with the x, by clicking outside it, or with Esc. **Save settings** closes it too.

**Lyric slides background image:** under the colour settings, choose a JPG, PNG, WebP or GIF to display as the background for all lyric slides (Google Sheet, songs.json, and local songs). Use the **Darken image** slider to ensure text readability. **Remove** goes back to solid background colour. Individual custom slides with their own background image will continue to use their custom image.

**Blank screen image:** under the colour settings, choose a JPG, PNG, WebP or GIF to show on the output window whenever it is blank (the `.` key or the Blank button) instead of a plain black screen. It is scaled to fit the screen, stored in this browser (IndexedDB) and used by both the preview and the output window. **Remove** goes back to black. Showing a song, video or slide hides it again.

## Controls

`→` / `Space` next slide · `←` previous · `.` blank screen · `F` Live on/off (when off, the output window is blank while the preview keeps working) · `N` / `P` next / previous set list song · `K` pause/play video · `S` restart video. Settings are stored in browser localStorage.

**App keys:** `R` reload the sheet · `O` open the output window · `I` open the Settings menu. Each key is shown next to its button, for example "Reload sheet (R)". They are ignored while you are typing in a field, while Settings is open, and when Ctrl, Cmd or Alt is held.

**Jump to a field** (the cursor goes straight in, and the letter is not typed): `L` library search · `A` Google Drive audio search · `C` Custom slide name (opens the editor) · `B` Bible verse reference (opens the editor). The key is shown next to each label, for example "Custom slide (C)", the same way as "Live (F)". Press `Esc` to fold the Custom slide, Bible verses and Google Drive audio boxes (and leave the field you are typing in) so the other keys work again; if Settings is open, `Esc` closes it first. These keys are ignored while you are typing in a field, while Settings is open, and when Ctrl, Cmd or Alt is held.
