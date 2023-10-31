import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { Change, diffWords } from 'diff';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

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

  token: string = '';
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
  // dataset = 'TinyStories';
  showSettings!: boolean;
  showAcks!: boolean;
  sourceLanguage!: string;
  targetLanguage!: string;
  diffMode!: DiffMode;
  minLength!: number;
  maxLength!: number;

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
    // TODO: the code for tokens is not ready yet
    // this.token = this.restore('token', '');
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
    let prompt = `Here is a text in ${this.sourceLanguage} followed by its translation to ${this.targetLanguage}. Respond with a corrected version of the translation witout any commentaries or preambles. If the translation is not complete only fix the existing part.`;
    prompt = `${prompt}\n\n${this.original}\n<--translation-->\n${this.translation}`;
    if (this.token.length > 0) {
      const response: any = await firstValueFrom(this.http.post('http://localhost:9000/api/check/', {
        prompt, token: this.token
      }));
      this.fixed = response.text;
      this.diff();
    } else {
      await copyToClipboard(prompt);
    }
  }

  async next() {
    // const response: any = await firstValueFrom(this.http.get('http://localhost:9000/api/sample/', {
    //   params: {
    //     min_length: this.minLength,
    //     max_length: this.maxLength,
    //   }
    // }));
    // this.original = response.text;

    const texts = this.localLibrary.filter(t => this.minLength <= t.length && t.length <= this.maxLength);
    if (texts.length > 0) {
      this.original = texts[Math.floor(Math.random() * texts.length)];
      this.translation = '';
      this.currentPosition = 0;
      this.clearDiffs();
    }
  }

  segmentColor(segment: Segment) {
    return segment.added!.length > 0 && segment.removed!.length > 0 ? 'blue' : 'red';
  }

  processSegment(start: number, segment: Change[]) {
    let added: string[] = [];
    let removed: string[] = [];
    segment.forEach(change => {
      if (change.added) {
        added.push(change.value);
      } else if (change.removed) {
        removed.push(change.value);
      } else if (/^\s*$/.test(change.value)) {
        added.push(change.value);
        removed.push(change.value);
      }
    })

    const left = removed.join('');
    const right = added.join('');
    return new Segment(start, start + left.length, undefined, left, right);
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
        const index = getLast(segments);
        segments.push(new Segment(index, index + change.value.length, change.value));
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
