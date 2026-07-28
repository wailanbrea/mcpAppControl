<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('tasks', function (Blueprint $table) {
            $table->id();
            $table->string('external_id')->unique();
            $table->foreignId('workflow_id')->constrained('workflows')->onDelete('cascade');
            $table->json('params')->nullable();
            $table->enum('status', ['scheduled', 'running', 'completed', 'failed', 'cancelled'])->default('scheduled');
            $table->timestamp('scheduled_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->text('error_message')->nullable();
            $table->timestamps();

            $table->index(['status', 'created_at']);
            $table->index('external_id');
        });
    }

    public function down(): void {
        Schema::dropIfExists('tasks');
    }
};
