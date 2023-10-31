import { Directive, ElementRef, HostListener, Renderer2 } from '@angular/core';

@Directive({
  selector: 'textarea[autoResize]'
})
export class AutoResizeTextareaDirective {
  constructor(private el: ElementRef<HTMLTextAreaElement>) { }

  private adjustTextareaHeight(textarea: HTMLTextAreaElement): void {
    textarea.style.overflow = 'hidden';
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 1 + 'px';
  }

  @HostListener('input', ['$event.target'])
  onInput(textarea: HTMLTextAreaElement): void {
    this.adjustTextareaHeight(textarea);
  }

  ngAfterViewInit(): void {
    this.adjustTextareaHeight(this.el.nativeElement);
  }

  ngAfterViewChecked(): void {
    this.adjustTextareaHeight(this.el.nativeElement);
  }
}
