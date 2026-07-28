<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('workflow_device_targets', function (Blueprint $table) {
            $table->foreignId('workflow_id')->constrained()->cascadeOnDelete();
            $table->foreignId('device_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->primary(['workflow_id', 'device_id']);
        });
    }

    public function down(): void {
        Schema::dropIfExists('workflow_device_targets');
    }
};
