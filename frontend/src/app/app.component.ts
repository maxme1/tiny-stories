import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { Change, diffWords } from 'diff';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from 'src/environments/environment';

export class Segment {
  constructor(
    public start: number, public stop: number, public common?: string, public removed?: string, public added?: string,
    public reason?: string
  ) { }
}

enum DiffMode {
  All,
  Current,
  None,
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  readonly DiffMode = DiffMode;
  @ViewChild("textarea") textarea!: ElementRef<HTMLTextAreaElement>;
  @ViewChild("fixedPaste") fixedPaste!: ElementRef<HTMLTextAreaElement>;

  // text
  translation: string = '';
  original: string = '';
  fixed: string = '';
  localLibrary: string[] = [];

  // differences
  segments: Segment[] = [];
  currentPosition: number = 0;
  reasons = new Map<string, string>();

  // settings
  showSettings!: boolean;
  showAcks!: boolean;
  sourceLanguage!: string;
  targetLanguage!: string;
  diffMode!: DiffMode;
  minLength!: number;
  maxLength!: number;
  staticMode!: boolean;
  token: string = '';

  // misc
  message: string = '';

  constructor(private http: HttpClient) { }

  // settings

  toggleSettings() {
    this.showSettings = !this.showSettings;
    this.store('showSettings', this.showSettings);
  }

  toggleAcknowlegements() {
    this.showAcks = !this.showAcks;
    this.store('showAcks', this.showAcks);
  }

  setDiffMode(value: DiffMode) {
    this.diffMode = value;
    this.store('diffMode', value);
  }

  clearDiffs() {
    this.fixed = '';
    this.segments = [];
  }

  store(field: string, value: any) {
    localStorage.setItem(field, JSON.stringify(value));
  }

  restore(field: string, missing: any): any {
    const value = localStorage.getItem(field);
    if (!value) return missing;
    return JSON.parse(value);
  }

  ngOnInit(): void {
    this.minLength = this.restore('minLength', 0);
    this.maxLength = this.restore('maxLength', 10000);
    this.sourceLanguage = this.restore('sourceLanguage', 'english');
    this.targetLanguage = this.restore('targetLanguage', 'european portuguese');
    this.diffMode = this.restore('diffMode', DiffMode.All);
    this.staticMode = this.restore('staticMode', true);
    this.token = this.restore('token', '');
    this.showSettings = this.restore('showSettings', false);
    this.showAcks = this.restore('showAcks', true);

    this.http.get('assets/tiny-stories.json').subscribe((data: any) => {
      this.localLibrary = data.texts;
    });
  }

  // copy-paste flow

  handlePaste(event: ClipboardEvent) {
    const data = event.clipboardData;
    if (data) {
      this.fixed = data.getData('text');
      this.diff();
    }
  }

  handleAfterPaste() {
    this.fixedPaste.nativeElement.value = '';
  }

  async checkTranslation() {
    if (this.token.length > 0) {
      try {
        const response: any = await firstValueFrom(this.http.post(`${environment.API_ROOT}/api/check/`, {
          original: this.original,
          translation: this.translation,
          sourceLanguage: this.sourceLanguage,
          targetLanguage: this.targetLanguage,
          token: this.token,
        }));
        this.fixed = response.text;
        this.diff();

      } catch (error) {
        this.processError(error);
      }
    } else {
      let prompt = `Here is a text in ${this.sourceLanguage} followed by its translation to ${this.targetLanguage}. Respond with a corrected version of the translation witout any commentaries or preambles. If the translation is not complete only fix the existing part.`;
      prompt = `${prompt}\n\n${this.original}\n<--translation-->\n${this.translation}`;
      await copyToClipboard(prompt);
    }
  }

  async next() {
    let text = '';
    if (this.staticMode) {
      const texts = this.localLibrary.filter(t => this.minLength <= t.length && t.length <= this.maxLength);
      if (texts.length > 0) {
        text = texts[Math.floor(Math.random() * texts.length)];
      }
    } else {
      try {
        const response: any = await firstValueFrom(this.http.get(`${environment.API_ROOT}/api/sample/`, {
          params: {
            min_length: this.minLength,
            max_length: this.maxLength,
          }
        }));
        text = response.text;

      } catch (error) {
        this.processError(error);
      }
    }
    if (text.length > 0) {
      this.original = text;
      this.translation = '';
      this.currentPosition = 0;
      this.clearDiffs();
    }
  }

  segmentColor(segment: Segment) {
    return segment.added!.length > 0 && segment.removed!.length > 0 ? 'blue' : 'red';
  }

  processSegment(start: number, changes: Change[]) {
    let added: string[] = [];
    let removed: string[] = [];
    changes.forEach(change => {
      if (change.added) {
        added.push(change.value);
      } else if (change.removed) {
        removed.push(change.value);
      } else if (/^\s*$/.test(change.value)) {
        added.push(change.value);
        removed.push(change.value);
      }
    })

    let left = removed.join('');
    let right = added.join('');
    const stop = start + left.length;
    // take the original text with possible diactrics
    left = this.translation.slice(start, stop);
    right = this.fixed.slice(start, start + right.length);
    return new Segment(start, stop, undefined, left, right);
  }

  updatePosition() {
    this.currentPosition = this.textarea.nativeElement.selectionStart;
  }

  async diff() {
    if (this.fixed.length == 0) return;

    let changes = diffWords(
      removeDiacritics(this.translation),
      removeDiacritics(this.fixed), { ignoreCase: true, ignoreWhitespace: true },
    );

    function getLast(segments: Segment[]) {
      return segments.length == 0 ? 0 : segments[segments.length - 1].stop;
    }

    let segments: Segment[] = [], edited = [];
    for (const change of changes) {
      if (change.added || change.removed || (/^\s*$/.test(change.value) && edited.length > 0)) {
        edited.push(change);

      } else {
        if (edited.length > 0) {
          segments.push(this.processSegment(getLast(segments), edited));
          edited = [];
        }
        const start = getLast(segments);
        const stop = start + change.value.length;
        // take the variant with fixed diactrics
        segments.push(new Segment(start, stop, this.fixed.slice(start, stop)));
      }
    }
    if (edited.length > 0) {
      segments.push(this.processSegment(getLast(segments), edited));
    }

    // segments.forEach(s => {
    //   if (!s.common) {
    //     const reason = this.reasons.get(`${s.removed}->${s.added}`);
    //     if (reason) {
    //       s.reason = reason;
    //     }
    //   }
    // })

    this.segments = segments;
  }

  processError(error: any) {
    let message;
    if (error instanceof HttpErrorResponse && error.status == 429) {
      message = 'Too many requests. Please try again later.';
    } else {
      message = 'An unknown error occurred ¯\_(ツ)_/¯';
    }
    this.message = message;
    setTimeout(() => {
      this.message = '';
    }, 5000);
  }
}

async function copyToClipboard(text: string) {
  if ('clipboard' in navigator) {
    await navigator.clipboard.writeText(text);
  } else {
    // fallback for browsers that don't support the Clipboard API
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }
}

function removeDiacritics(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
